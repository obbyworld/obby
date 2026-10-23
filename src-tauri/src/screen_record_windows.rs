//! Recording a rectangle of the screen on Windows.
//!
//! Windows ships no recorder we can drive from the command line, so rather
//! than make everyone install ffmpeg we use what the system already has:
//! Graphics Capture for the frames and Media Foundation for the H.264, both
//! reached through the `windows-capture` crate.

use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};

use crate::screen_record::Rect;

/// The encoder is shared so the file can be closed from whoever stops the
/// recording. A capture only delivers a frame when something on screen moves,
/// so a capture thread asked to close its own file may never be asked again.
type SharedEncoder = Arc<Mutex<Option<VideoEncoder>>>;

/// What the capture thread needs to know, handed over when it starts.
#[derive(Clone)]
pub struct RegionFlags {
    crop: Rect,
    path: String,
    encoder: SharedEncoder,
    started: Arc<Mutex<Option<Sender<Result<(), String>>>>>,
}

struct RegionRecorder {
    encoder: SharedEncoder,
    crop: Rect,
}

impl GraphicsCaptureApiHandler for RegionRecorder {
    type Flags = RegionFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let flags = ctx.flags;
        // The encoder is told the size of the crop, not of the screen, so what
        // lands in the file is the rectangle and nothing around it.
        let opened = VideoEncoder::new(
            VideoSettingsBuilder::new(flags.crop.width, flags.crop.height),
            AudioSettingsBuilder::default().disabled(true),
            ContainerSettingsBuilder::default(),
            &flags.path,
        )
        .map_err(|e| e.to_string());

        let outcome = match &opened {
            Ok(_) => Ok(()),
            Err(e) => Err(e.clone()),
        };
        // Whoever asked for the recording is waiting to hear whether the
        // encoder opened at all, since that happens on this thread.
        if let Ok(mut slot) = flags.started.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(outcome);
            }
        }

        *flags.encoder.lock().map_err(|e| e.to_string())? = Some(opened?);
        Ok(Self {
            encoder: flags.encoder,
            crop: flags.crop,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let mut slot = self.encoder.lock().map_err(|e| e.to_string())?;
        let Some(encoder) = slot.as_mut() else {
            return Ok(());
        };
        let timestamp = frame.timestamp().map_err(|e| e.to_string())?.Duration;
        let cropped = frame
            .buffer_crop(
                self.crop.x.max(0) as u32,
                self.crop.y.max(0) as u32,
                self.crop.x.max(0) as u32 + self.crop.width,
                self.crop.y.max(0) as u32 + self.crop.height,
            )
            .map_err(|e| e.to_string())?;
        let mut scratch = Vec::new();
        let pixels = cropped.as_nopadding_buffer(&mut scratch);
        encoder
            .send_frame_buffer(pixels, timestamp)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        close(&self.encoder)
    }
}

/// Writes the index a player needs and leaves the file complete.
fn close(encoder: &SharedEncoder) -> Result<(), String> {
    let taken = encoder.lock().map_err(|e| e.to_string())?.take();
    match taken {
        Some(encoder) => encoder.finish().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub struct WindowsRecording {
    encoder: SharedEncoder,
    control: Option<
        windows_capture::capture::CaptureControl<
            RegionRecorder,
            <RegionRecorder as GraphicsCaptureApiHandler>::Error,
        >,
    >,
}

/// Starts recording `crop` into `path`. `crop` is in pixels measured from the
/// top left of that monitor, which is how a captured frame is laid out.
/// Returns once the encoder is open, so a failure to start is reported here
/// rather than discovered on stopping.
pub fn start(crop: Rect, path: &str, monitor_index: usize) -> Result<WindowsRecording, String> {
    let monitor = Monitor::from_index(monitor_index + 1)
        .or_else(|_| Monitor::primary())
        .map_err(|e| e.to_string())?;

    let encoder: SharedEncoder = Arc::new(Mutex::new(None));
    let (tx, rx) = channel();
    let flags = RegionFlags {
        crop,
        path: path.to_string(),
        encoder: Arc::clone(&encoder),
        started: Arc::new(Mutex::new(Some(tx))),
    };

    let settings = Settings::new(
        monitor,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );

    let control = RegionRecorder::start_free_threaded(settings).map_err(|e| e.to_string())?;
    match rx.recv() {
        Ok(Ok(())) => Ok(WindowsRecording {
            encoder,
            control: Some(control),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("the recorder stopped before it started".into()),
    }
}

impl WindowsRecording {
    /// Ends the capture, then closes the file once no more frames can arrive.
    pub fn stop(mut self) -> Result<(), String> {
        if let Some(control) = self.control.take() {
            control.stop().map_err(|e| e.to_string())?;
        }
        close(&self.encoder)
    }
}
