import Tauri
import UIKit

@_cdecl("ios_share_file")
func iosShareFile(_ pathPtr: UnsafePointer<CChar>?) {
  guard let pathPtr else { return }
  let fileURL = URL(fileURLWithPath: String(cString: pathPtr))

  DispatchQueue.main.async {
    guard
      let scene = UIApplication.shared.connectedScenes
        .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
      let rootVC = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
    else { return }

    let activityVC = UIActivityViewController(
      activityItems: [fileURL],
      applicationActivities: nil
    )

    // iPad requires a popover anchor, otherwise it crashes
    if let popover = activityVC.popoverPresentationController {
      popover.sourceView = rootVC.view
      popover.sourceRect = CGRect(
        x: rootVC.view.bounds.midX,
        y: rootVC.view.bounds.midY,
        width: 0,
        height: 0
      )
      popover.permittedArrowDirections = []
    }

    rootVC.present(activityVC, animated: true)
  }
}
