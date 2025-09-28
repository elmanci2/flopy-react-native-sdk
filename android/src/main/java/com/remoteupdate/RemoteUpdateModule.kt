package com.remoteupdate

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(private val reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  // Obtenemos una instancia de nuestro cerebro nativo, Flopy
  private val flopyInstance: Flopy by lazy { Flopy.getInstance(reactContext) }

  override fun getName(): String = NAME

  /** Expone constantes al lado de JavaScript. Se cargan una sola vez al inicio. */
  override fun getConstants(): Map<String, Any> {
    val constants = mutableMapOf<String, Any>()
    try {
      // Este es el directorio seguro para todas nuestras operaciones.
      val flopyDir = reactContext.filesDir.resolve("flopy")

      constants["flopyPath"] = flopyDir.absolutePath
      // Devolvemos el path por defecto. El lado JS no necesita saber si fue sobreescrito.
      constants["initialBundlePath"] = "assets://index.android.bundle"
    } catch (e: Exception) {
      Log.e(NAME, "Error retrieving constants", e)
      constants["flopyPath"] = ""
      constants["initialBundlePath"] = ""
    }
    return constants
  }

  /** Reinicia la aplicación para aplicar una actualización. */
  @ReactMethod
  fun restartApp() {
    val activity = currentActivity ?: return

    // Accedemos al ReactInstanceManager a través del ReactContext, que es la forma segura y
    // correcta.
    // Esto NO causa el error de referencia no resuelta.
    val reactInstanceManager = reactContext.reactInstanceManager
    if (reactInstanceManager == null) {
      Log.e(NAME, "ReactInstanceManager is null, cannot restart app.")
      return
    }

    activity.runOnUiThread {
      try {
        reactInstanceManager.recreateReactContextInBackground()
      } catch (e: Exception) {
        Log.e(NAME, "Failed to restart app via recreateReactContextInBackground", e)
      }
    }
  }

  /** Le dice al orquestador nativo que el último arranque falló. */
  @ReactMethod
  fun recordFailedBoot() {
    flopyInstance.incrementFailedBootCount()
  }

  /** Le dice al orquestador nativo que el último arranque fue exitoso. */
  @ReactMethod
  fun resetBootStatus() {
    flopyInstance.resetFailedBootCount()
  }

  companion object {
    const val NAME = "RemoteUpdate"
  }
}
