package com.obsidianirc.dev

import android.webkit.WebView
import android.annotation.SuppressLint
import android.view.ViewTreeObserver
import android.view.View
import android.graphics.Rect
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.util.Rational
import android.webkit.JavascriptInterface
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat


class MainActivity : TauriActivity() {
  private lateinit var wv: WebView
  private var isKeyboardOpen = false
  @Volatile private var isInCall = false

  // Android restores a killed app with its first intent and hands a notification tap over
  // as a new intent, so we keep the tap as the intent the plugins read when they load.
  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    wv = webView
    setupKeyboardDetection()
    webView.addJavascriptInterface(CallBridge(), "ObbyNative")
  }

  // The web app tells us when a call is live, so leaving the app keeps the call
  // visible in a picture-in-picture window.
  private inner class CallBridge {
    @JavascriptInterface
    fun setInCall(active: Boolean) {
      isInCall = active
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        runOnUiThread { setPictureInPictureParams(pipParams(active)) }
      }
    }
  }

  private fun pipParams(autoEnter: Boolean): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(autoEnter).setSeamlessResizeEnabled(true)
    }
    return builder.build()
  }

  // Android 12+ enters picture-in-picture on its own through setAutoEnterEnabled.
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (isInCall && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      enterPictureInPictureMode(pipParams(false))
    }
  }

  // WryActivity pauses the WebView on onPause, which Android also sends when the
  // activity moves into picture-in-picture, so we keep it drawing while pinned.
  override fun onPause() {
    super.onPause()
    if (::wv.isInitialized && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
      isInPictureInPictureMode) {
      wv.onResume()
    }
  }

  override fun onPictureInPictureModeChanged(isInPip: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPip, newConfig)
    if (::wv.isInitialized) {
      if (isInPip) wv.onResume()
      wv.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('obby-native-pip', { detail: $isInPip }));",
        null,
      )
    }
  }
  
  private fun setupKeyboardDetection() {
    val rootView = findViewById<View>(android.R.id.content)
    // Edge-to-edge (forced from Android 15) ignores adjustResize, so we shrink
    // the WebView by the keyboard height ourselves; otherwise Android only pans it.
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.setPadding(0, 0, 0, imeBottom)
      insets
    }
    val globalLayoutListener = ViewTreeObserver.OnGlobalLayoutListener {
      val rect = Rect()
      rootView.getWindowVisibleDisplayFrame(rect)
      val screenHeight = rootView.rootView.height
      val keypadHeight = screenHeight - rect.bottom

      if (keypadHeight > screenHeight * 0.15) { // keyboard is opened
        if (!isKeyboardOpen) {
          isKeyboardOpen = true
          // Force immediate layout adjustment
          wv.evaluateJavascript("window.dispatchEvent(new Event('keyboardDidShow'));", null)
        }
      } else { // keyboard is closed
        if (isKeyboardOpen) {
          isKeyboardOpen = false
          wv.evaluateJavascript("window.dispatchEvent(new Event('keyboardDidHide'));", null)
        }
      }
    }
    
    rootView.viewTreeObserver.addOnGlobalLayoutListener(globalLayoutListener)
  }
  
  @SuppressLint("MissingSuperCall", "SetTextI18n")
  @Deprecated("")
  override fun onBackPressed() {
    wv.evaluateJavascript(/* script = */ """
      try {
        window.androidBackCallback()
      } catch (_) {
        true
      }
    """.trimIndent()) { result ->
      if (result == "true") {
        super.onBackPressed();
      }
    }
  }
}