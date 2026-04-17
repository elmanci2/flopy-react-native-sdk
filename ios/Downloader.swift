import Foundation
import UIKit

@objc(Downloader)
class Downloader: NSObject, URLSessionDownloadDelegate {
    private weak var bridge: RCTBridge?
    private var activeDownloads: [String: DownloadTask] = [:]
    private let queue = DispatchQueue(label: "com.flopy.downloader")

    struct DownloadTask {
        let downloadId: String
        let destination: String
        let promise: (resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)
    }

    init(bridge: RCTBridge?) {
        self.bridge = bridge
        super.init()
    }

    func download(url: URL, destination: String, downloadId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        // H5: Validar esquema de URL
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            reject("DOWNLOAD_ERROR", "URL scheme no soportado. Solo HTTP/HTTPS permitidos.", nil)
            return
        }

        // Crear sesión con delegate para reporte de progreso
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30 // 30s connect timeout
        config.timeoutIntervalForResource = 300 // 5min total timeout

        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        let task = session.downloadTask(with: url)

        queue.sync {
            activeDownloads["\(task.taskIdentifier)"] = DownloadTask(
                downloadId: downloadId,
                destination: destination,
                promise: (resolve: resolve, reject: reject)
            )
        }

        task.resume()
    }

    // MARK: - URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let key = "\(downloadTask.taskIdentifier)"
        guard let download = queue.sync(execute: { activeDownloads[key] }) else { return }

        do {
            let destinationURL = URL(fileURLWithPath: download.destination)
            // Crear directorio padre si no existe
            let parentDir = destinationURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true)
            // Limpiar archivo anterior
            try? FileManager.default.removeItem(at: destinationURL)
            try FileManager.default.moveItem(at: location, to: destinationURL)

            emitResult(id: download.downloadId, success: true)
            download.promise.resolve(nil)
        } catch {
            emitError(id: download.downloadId, message: error.localizedDescription)
            download.promise.reject("DOWNLOAD_ERROR", error.localizedDescription, error)
        }

        queue.sync { activeDownloads.removeValue(forKey: key) }
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error else { return } // Sin error, se maneja en didFinishDownloadingTo
        let key = "\(task.taskIdentifier)"
        guard let download = queue.sync(execute: { activeDownloads[key] }) else { return }

        emitError(id: download.downloadId, message: error.localizedDescription)
        download.promise.reject("DOWNLOAD_ERROR", error.localizedDescription, error)

        queue.sync { activeDownloads.removeValue(forKey: key) }
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let key = "\(downloadTask.taskIdentifier)"
        guard let download = queue.sync(execute: { activeDownloads[key] }) else { return }

        if totalBytesExpectedToWrite > 0 {
            let progress = Int(totalBytesWritten * 100 / totalBytesExpectedToWrite)
            emitProgress(
                id: download.downloadId,
                progress: progress,
                bytesWritten: totalBytesWritten,
                contentLength: totalBytesExpectedToWrite
            )
        }
    }

    // MARK: - Event Emission

    private func emitProgress(id: String, progress: Int, bytesWritten: Int64, contentLength: Int64) {
        bridge?.enqueueJSCall("RCTDeviceEventEmitter", methodName: "emit", args: [
            "downloadProgress",
            [
                "id": id,
                "progress": progress,
                "bytesWritten": bytesWritten,
                "contentLength": contentLength
            ]
        ], completion: nil)
    }

    private func emitResult(id: String, success: Bool) {
        bridge?.enqueueJSCall("RCTDeviceEventEmitter", methodName: "emit", args: [
            "downloadFinished",
            [
                "id": id,
                "success": success
            ]
        ], completion: nil)
    }

    private func emitError(id: String, message: String) {
        bridge?.enqueueJSCall("RCTDeviceEventEmitter", methodName: "emit", args: [
            "downloadError",
            [
                "id": id,
                "error": message
            ]
        ], completion: nil)
    }
}
