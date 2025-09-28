// android/src/main/java/com/remoteupdate/RemoteUpdateModule.kt
package com.remoteupdate

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(private val reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  // Obtenemos una instancia de nuestro cerebro nativo
  private val flopyInstance: Flopy by lazy { Flopy.getInstance(reactContext) }

  override fun getName(): String {
    return NAME
  }

  override fun getConstants(): Map<String, Any>? {
    val constants = mutableMapOf<String, Any>()
    try {
      val host = reactContext.reactInstanceManager.reactNativeHost
      val initialBundlePath = host.jsBundleFile ?: "assets://index.android.bundle"
      val flopyDir = reactContext.filesDir.resolve("flopy")

      constants["flopyPath"] = flopyDir.absolutePath
      constants["initialBundlePath"] = initialBundlePath

      return constants
    } catch (e: Exception) {
      e.printStackTrace()
      return mapOf("flopyPath" to "", "initialBundlePath" to "")
    }
  }

  @ReactMethod
  fun restartApp() {
    val activity = currentActivity
    if (activity != null) {
      activity.runOnUiThread {
        try {
          reactContext.reactInstanceManager.recreateReactContextInBackground()
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
    // Mantenemos el nombre del módulo antiguo para compatibilidad con tu JS si es necesario
    // Pero idealmente lo cambiamos a "FlopyModule" para claridad.
    const val NAME = "RemoteUpdate" // O "FlopyModule"
  }
}
