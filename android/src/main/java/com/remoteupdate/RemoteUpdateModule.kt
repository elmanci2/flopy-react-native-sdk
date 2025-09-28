package com.remoteupdate

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  private val flopyInstance: Flopy by lazy { Flopy.getInstance(reactApplicationContext) }

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> {
    val constants = mutableMapOf<String, Any>()
    try {
      // Este es el directorio seguro para todas nuestras operaciones.
      val flopyDir = reactApplicationContext.filesDir.resolve("flopy")

      constants["flopyPath"] = flopyDir.absolutePath
      // Devolvemos el path por defecto. El JS no necesita saber si fue sobreescrito.
      constants["initialBundlePath"] = "assets://index.android.bundle"
    } catch (e: Exception) {
      Log.e(NAME, "Error retrieving constants", e)
      constants["flopyPath"] = ""
      constants["initialBundlePath"] = ""
    }
    return constants
  }

  @ReactMethod
  fun restartApp() {
    val activity = currentActivity ?: return
    activity.runOnUiThread {
      try {
        // Obtenemos la instancia de forma segura
        val reactInstanceManager =
                (activity.application as ReactApplication).reactNativeHost.reactInstanceManager
        reactInstanceManager.recreateReactContextInBackground()
      } catch (e: Exception) {
        Log.e(NAME, "Failed to restart app", e)
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
