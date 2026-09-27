import { t } from "@lingui/core/macro";
import { useRef, useState } from "react";
import {
  FaDesktop,
  FaDoorOpen,
  FaHandPaper,
  FaKeyboard,
  FaMicrophone,
  FaMicrophoneSlash,
  FaPhoneSlash,
  FaSlidersH,
  FaSmile,
  FaVideo,
  FaVideoSlash,
  FaVolumeMute,
  FaVolumeUp,
} from "react-icons/fa";
import { LuEllipsis } from "react-icons/lu";
import Menu from "../ui/Menu";
import Popover from "../ui/Popover";
import { DockButton } from "./DockButton";

const REACTIONS = [
  "\u{1F44D}",
  "\u{1F44F}",
  "❤️",
  "\u{1F602}",
  "\u{1F389}",
  "\u{1F525}",
];

export interface VoiceDockProps {
  isNarrow: boolean;
  isTouch: boolean;
  isStreamer: boolean;
  micOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  deafened: boolean;
  handRaised: boolean;
  pttOn: boolean;
  canStepOffStream: boolean;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onToggleDeafen: () => void;
  onToggleHand: () => void;
  onTogglePtt: () => void;
  onStepOffStream: () => void;
  onReact: (emoji: string) => void;
  onLeave: () => void;
  onOpenDeviceSettings: () => void;
}

/** The floating control pill. Every button reflects state passed in by
 *  the caller (which reads it from the client), never state of its
 *  own, so it stays correct across remounts. */
export function VoiceDock({
  isNarrow,
  isTouch,
  isStreamer,
  micOn,
  videoOn,
  screenOn,
  deafened,
  handRaised,
  pttOn,
  canStepOffStream,
  onToggleMic,
  onToggleVideo,
  onToggleScreen,
  onToggleDeafen,
  onToggleHand,
  onTogglePtt,
  onStepOffStream,
  onReact,
  onLeave,
  onOpenDeviceSettings,
}: VoiceDockProps) {
  const reactRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [reactAnchor, setReactAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const size = isNarrow ? "sm" : "md";
  // Hand raise is a main dock button except on a streamer's phone layout,
  // where it moves into "more" to keep the row at six buttons.
  const handDirect = !isStreamer || !isNarrow;

  const moreItems = [
    {
      id: "device-settings",
      show: true,
      icon: <FaSlidersH />,
      label: t`Choose microphone and camera`,
      onClick: onOpenDeviceSettings,
    },
    {
      id: "hand",
      show: isStreamer && isNarrow,
      icon: <FaHandPaper />,
      label: handRaised ? t`Lower hand` : t`Raise hand`,
      onClick: onToggleHand,
    },
    {
      id: "ptt",
      show: isStreamer && !isTouch,
      icon: <FaKeyboard />,
      label: pttOn ? t`Disable push-to-talk` : t`Enable push-to-talk`,
      onClick: onTogglePtt,
    },
    {
      id: "step-off",
      show: canStepOffStream,
      icon: <FaDoorOpen />,
      label: t`Step off stream`,
      onClick: onStepOffStream,
    },
  ];
  const showMore = moreItems.some((item) => item.show);

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-discord-dark-300/90 backdrop-blur shadow-lg overflow-x-auto max-w-full">
      {isStreamer && (
        <DockButton
          icon={micOn ? <FaMicrophone /> : <FaMicrophoneSlash />}
          state={micOn ? "neutral" : "off"}
          size={size}
          label={micOn ? t`Mute` : t`Unmute`}
          onClick={onToggleMic}
        />
      )}
      {isStreamer && (
        <DockButton
          icon={videoOn ? <FaVideo /> : <FaVideoSlash />}
          state={videoOn ? "neutral" : "off"}
          size={size}
          label={videoOn ? t`Stop video` : t`Start video`}
          onClick={onToggleVideo}
        />
      )}
      {isStreamer && !isTouch && (
        <DockButton
          icon={<FaDesktop />}
          state={screenOn ? "active" : "neutral"}
          size={size}
          label={screenOn ? t`Stop sharing` : t`Share screen`}
          onClick={onToggleScreen}
        />
      )}
      <DockButton
        icon={deafened ? <FaVolumeMute /> : <FaVolumeUp />}
        state={deafened ? "off" : "neutral"}
        size={size}
        label={deafened ? t`Undeafen` : t`Deafen`}
        onClick={onToggleDeafen}
      />
      {handDirect && (
        <DockButton
          icon={<FaHandPaper />}
          state={handRaised ? "active" : "neutral"}
          size={size}
          label={handRaised ? t`Lower hand` : t`Raise hand`}
          onClick={onToggleHand}
        />
      )}
      <span ref={reactRef}>
        <DockButton
          icon={<FaSmile />}
          size={size}
          label={t`React`}
          onClick={() => setReactAnchor(reactRef.current)}
        />
      </span>
      {showMore && (
        <span ref={moreRef}>
          <DockButton
            icon={<LuEllipsis />}
            size={size}
            label={t`More`}
            onClick={() => setMoreAnchor(moreRef.current)}
          />
        </span>
      )}
      <DockButton
        icon={<FaPhoneSlash />}
        state="danger"
        size={size}
        label={t`Leave call`}
        onClick={onLeave}
      />

      <Popover
        isOpen={reactAnchor !== null}
        onClose={() => setReactAnchor(null)}
        anchor={reactAnchor}
        width={224}
        role="menu"
      >
        <div className="flex flex-wrap gap-2 p-2">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact(emoji);
                setReactAnchor(null);
              }}
              className="w-12 h-12 rounded-full bg-discord-dark-200 hover:bg-discord-dark-400 text-2xl leading-none flex items-center justify-center"
            >
              {emoji}
            </button>
          ))}
        </div>
      </Popover>

      <Menu
        isOpen={moreAnchor !== null}
        onClose={() => setMoreAnchor(null)}
        anchorElement={moreAnchor}
        menuItems={moreItems}
      />
    </div>
  );
}

export default VoiceDock;
