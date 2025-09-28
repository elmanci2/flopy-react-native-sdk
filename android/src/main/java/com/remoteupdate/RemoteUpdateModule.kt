// android/src/main/java/com/remoteupdate/RemoteUpdateModule.kt
package com.remoteupdate

import com.facebook.react.ReactApplication
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  private val flopyInstance: Flopy by lazy { Flopy.getInstance(reactApplicationContext) }

  override fun getName(): String {
    return NAME
  }

  override fun getConstants(): Map<String, Any> {
    val constants = mutableMapOf<String, Any>()
    try {
      val reactApp = reactApplicationContext.applicationContext as ReactApplication
      val host = reactApp.reactNativeHost
      val initialBundlePath = host.jsBundleFile ?: "assets://index.android.bundle"
      val flopyDir = reactApplicationContext.filesDir.resolve("flopy")

      constants["flopyPath"] = flopyDir.absolutePath
      constants["initialBundlePath"] = initialBundlePath
    } catch (e: Exception) {
      e.printStackTrace()
      constants["flopyPath"] = ""
      constants["initialBundlePath"] = ""
    }
    return constants
  }

  @ReactMethod
  fun restartApp() {
    val activity = currentActivity
    if (activity != null) {
      activity.runOnUiThread {
        try {
          val reactApp = reactApplicationContext.applicationContext as ReactApplication
          val reactInstanceManager = reactApp.reactNativeHost.reactInstanceManager
          reactInstanceManager.recreateReactContextInBackground()
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
    }
  }

  @ReactMethod
  fun recordFailedBoot() {
    flopyInstance.incrementFailedBootCount()
  }

  @ReactMethod
  fun resetBootStatus() {
    flopyInstance.resetFailedBootCount()
  }

  companion object {
    const val NAME = "RemoteUpdate"
  }
}
