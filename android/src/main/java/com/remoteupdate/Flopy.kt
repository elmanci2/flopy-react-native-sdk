package com.remoteupdate

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import org.json.JSONObject

class Flopy(private val context: Context) {
  private val flopyDir = context.filesDir.resolve("flopy")
  private val stateFile = File(flopyDir, "flopy_state.json")

  companion object {
    @Volatile private var instance: Flopy? = null
    fun getInstance(context: Context): Flopy =
            instance
                    ?: synchronized(this) {
                      instance ?: Flopy(context.applicationContext).also { instance = it }
                    }
  }

  // EXACTAMENTE COMO TU CÓDIGO VIEJO - Simple y directo
  fun getJSBundleFile(): String? {
    return if (stateFile.exists()) {
      try {
        val jsonString = stateFile.readText()
        val json = JSONObject(jsonString)
        val failedBootCount = json.optInt("failedBootCount", 0)

        if (failedBootCount < 2) {
          val currentPackage = json.optJSONObject("currentPackage")
          val relativePath = currentPackage?.optString("relativePath")

          if (relativePath != null) {
            val bundleFile = File(flopyDir, relativePath)
            if (bundleFile.exists()) {
              return bundleFile.absolutePath
            }
          }

          // Fallback a previousPackage si currentPackage falla
          val previousPackage = json.optJSONObject("previousPackage")
          val prevRelativePath = previousPackage?.optString("relativePath")

          if (prevRelativePath != null) {
            val bundleFile = File(flopyDir, prevRelativePath)
            if (bundleFile.exists()) {
              return bundleFile.absolutePath
            }
          }
        }
        null
      } catch (e: Exception) {
        e.printStackTrace()
        null
      }
    } else {
      null
    }
  }

  fun saveState(stateMap: ReadableMap?) {
    if (stateMap == null) return

    try {
      val json = JSONObject()

      if (stateMap.hasKey("currentPackage")) {
        val currentPackage = stateMap.getMap("currentPackage")
        if (currentPackage != null) {
          val current = JSONObject()
          current.put("relativePath", currentPackage.getString("relativePath"))
          current.put("hash", currentPackage.getString("hash"))
          current.put("releaseId", currentPackage.getString("releaseId"))
          json.put("currentPackage", current)
        }
      }

      if (stateMap.hasKey("previousPackage")) {
        val previousPackage = stateMap.getMap("previousPackage")
        if (previousPackage != null) {
          val previous = JSONObject()
          previous.put("relativePath", previousPackage.getString("relativePath"))
          previous.put("hash", previousPackage.getString("hash"))
          previous.put("releaseId", previousPackage.getString("releaseId"))
          json.put("previousPackage", previous)
        }
      }

      json.put("failedBootCount", stateMap.getInt("failedBootCount"))

      flopyDir.mkdirs()
      stateFile.writeText(json.toString())
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  fun readState(): WritableMap? {
    return try {
      if (!stateFile.exists()) return null

      val json = JSONObject(stateFile.readText())
      val state = Arguments.createMap()

      if (json.has("currentPackage")) {
        val currentJson = json.getJSONObject("currentPackage")
        val currentPackage = Arguments.createMap()
        currentPackage.putString("relativePath", currentJson.optString("relativePath"))
        currentPackage.putString("hash", currentJson.optString("hash"))
        currentPackage.putString("releaseId", currentJson.optString("releaseId"))
        state.putMap("currentPackage", currentPackage)
      }

      if (json.has("previousPackage")) {
        val previousJson = json.getJSONObject("previousPackage")
        val previousPackage = Arguments.createMap()
        previousPackage.putString("relativePath", previousJson.optString("relativePath"))
        previousPackage.putString("hash", previousJson.optString("hash"))
        previousPackage.putString("releaseId", previousJson.optString("releaseId"))
        state.putMap("previousPackage", previousPackage)
      }

      state.putInt("failedBootCount", json.optInt("failedBootCount", 0))
      state
    } catch (e: Exception) {
      e.printStackTrace()
      null
    }
  }

  fun incrementFailedBootCount() {
    try {
      if (stateFile.exists()) {
        val json = JSONObject(stateFile.readText())
        json.put("failedBootCount", json.optInt("failedBootCount", 0) + 1)
        stateFile.writeText(json.toString())
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  fun resetFailedBootCount() {
    try {
      if (stateFile.exists()) {
        val json = JSONObject(stateFile.readText())
        json.put("failedBootCount", 0)
        stateFile.writeText(json.toString())
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }
}
