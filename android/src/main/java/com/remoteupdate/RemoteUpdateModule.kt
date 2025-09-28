// android/src/main/java/com/remoteupdate/RemoteUpdateModule.kt
package com.remoteupdate

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  // Obtenemos una instancia de nuestro cerebro nativo
  private val flopyInstance: Flopy by lazy {
    Flopy.getInstance(
            reactApplicationContext
    ) // Usamos reactApplicationContext aquí también por consistencia
  }

  override fun getName(): String {
    return NAME
  }

  override fun getConstants(): Map<String, Any>? {
    val constants = mutableMapOf<String, Any>()
    try {
      // --- CORRECCIÓN AQUÍ ---
      // Usamos `reactApplicationContext` que es una propiedad de la clase base
      val host = reactApplicationContext.reactInstanceManager.reactNativeHost
      val initialBundlePath = host.jsBundleFile ?: "assets://index.android.bundle"
      val flopyDir = reactApplicationContext.filesDir.resolve("flopy")

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
          // --- Y CORRECCIÓN AQUÍ ---
          // Usamos `reactApplicationContext` para acceder al instanceManager
          reactApplicationContext.reactInstanceManager.recreateReactContextInBackground()
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
