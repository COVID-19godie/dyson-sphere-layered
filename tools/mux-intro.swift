/**
 * 把无声画面 MP4 与完整配音 M4A 合成一条带音轨的成片。
 *
 * 只用系统自带 AVFoundation，不装 ffmpeg / 不引入任何第三方依赖。
 * 优先 AVAssetExportPresetPassthrough：两端都已经是 MP4 能承载的编码
 * （H.264 视频 + AAC 音频），这一步只重写容器、不重编码，画质无损且很快。
 * 万一 passthrough 被拒（比如源是分片 MP4），退到 HighestQuality 重编码。
 *
 *   swift tools/mux-intro.swift <video.mp4> <audio.m4a> <out.mp4>
 */
import Foundation
import AVFoundation

let args = CommandLine.arguments
guard args.count == 4 else {
    fputs("usage: mux-intro <video.mp4> <audio.m4a> <out.mp4>\n", stderr)
    exit(2)
}
let videoURL = URL(fileURLWithPath: args[1])
let audioURL = URL(fileURLWithPath: args[2])
let outURL = URL(fileURLWithPath: args[3])

let video = AVURLAsset(url: videoURL)
let audio = AVURLAsset(url: audioURL)
guard let vSrc = video.tracks(withMediaType: .video).first else {
    fputs("[mux] no video track in \(videoURL.path)\n", stderr); exit(1)
}
guard let aSrc = audio.tracks(withMediaType: .audio).first else {
    fputs("[mux] no audio track in \(audioURL.path)\n", stderr); exit(1)
}

let duration = video.duration
let comp = AVMutableComposition()
let vDst = comp.addMutableTrack(withMediaType: .video,
                                preferredTrackID: kCMPersistentTrackID_Invalid)!
let aDst = comp.addMutableTrack(withMediaType: .audio,
                                preferredTrackID: kCMPersistentTrackID_Invalid)!
do {
    try vDst.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: vSrc, at: .zero)
    // 配音轨比画面长 0.2s（尾部留白），按画面时长截断，避免导出多出一截黑尾
    let audioDur = CMTimeMinimum(duration, audio.duration)
    try aDst.insertTimeRange(CMTimeRange(start: .zero, duration: audioDur), of: aSrc, at: .zero)
} catch {
    fputs("[mux] insert failed: \(error)\n", stderr); exit(1)
}

func run(_ preset: String) -> Bool {
    guard let ex = AVAssetExportSession(asset: comp, presetName: preset) else { return false }
    try? FileManager.default.removeItem(at: outURL)
    ex.outputURL = outURL
    ex.outputFileType = .mp4
    ex.shouldOptimizeForNetworkUse = true
    let sem = DispatchSemaphore(value: 0)
    ex.exportAsynchronously { sem.signal() }
    sem.wait()
    if ex.status == .completed { return true }
    fputs("[mux] preset \(preset) -> \(ex.status.rawValue): \(String(describing: ex.error))\n", stderr)
    return false
}

if run(AVAssetExportPresetPassthrough) {
    print("[mux] passthrough ok")
} else if run(AVAssetExportPresetHighestQuality) {
    print("[mux] re-encoded ok")
} else {
    fputs("[mux] all presets failed\n", stderr); exit(1)
}

let attrs = try? FileManager.default.attributesOfItem(atPath: outURL.path)
let mb = ((attrs?[.size] as? NSNumber)?.doubleValue ?? 0) / 1048576.0
print(String(format: "[mux] %@  %.2f MB  video %.3fs", outURL.lastPathComponent, mb,
             CMTimeGetSeconds(duration)))
