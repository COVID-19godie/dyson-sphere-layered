/**
 * 成片体检：轨道 / 时长 / 分辨率 / 音轨 RMS / 关键帧抽图。
 *
 * 只用系统 AVFoundation，不装 ffprobe。用途是确认三件容易被"能播放"掩盖的事：
 *  - 视频与音频轨都在，时长接近 timeline.json 的 150.483s；
 *  - 音轨不是一条空 AAC（MediaRecorder 挂起时会写出静音轨）；
 *  - 字幕真的烧在画面里、九个镜头没有黑帧。
 *
 *   swift tools/verify-intro.swift <intro.mp4> [preview-prefix]
 */
import Foundation
import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("usage: verify-intro <intro.mp4> [preview-prefix]\n", stderr); exit(2)
}
let url = URL(fileURLWithPath: args[1])
let prefix = args.count >= 3 ? args[2] : "preview/_final"
let asset = AVURLAsset(url: url)

let secs = CMTimeGetSeconds(asset.duration)
print(String(format: "[verify] duration %.3fs", secs))
for tr in asset.tracks {
    let size = tr.naturalSize
    print("[verify] track \(tr.mediaType.rawValue)  \(Int(size.width))x\(Int(size.height))  \(tr.formatDescriptions.count) fmt")
}
let hasVideo = !asset.tracks(withMediaType: .video).isEmpty
let hasAudio = !asset.tracks(withMediaType: .audio).isEmpty
print("[verify] video=\(hasVideo) audio=\(hasAudio)")

// ---- 抽关键帧：开场推镜 / 收能层 / 结构层 / 地表 / 收尾
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
let marks: [(Double, String)] = [
    (1.0, "title"), (2.5, "opening"), (8.0, "I1"), (42.0, "I3"), (57.0, "I4"),
    (73.0, "I5"), (105.0, "I7"), (118.0, "I8"), (145.0, "I9"),
]
for (t, label) in marks where t < secs {
    do {
        let cg = try gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil)
        let rep = NSBitmapImageRep(cgImage: cg)
        if let data = rep.representation(using: .png, properties: [:]) {
            let dst = "\(prefix)-\(label).png"
            try data.write(to: URL(fileURLWithPath: dst))
            print("[verify] frame \(String(format: "%.1f", t))s -> \(dst)")
        }
    } catch {
        print("[verify] frame \(t)s failed: \(error)")
    }
}

// ---- 音轨电平：只读前 24 秒（第一句配音在 1.95s，足够判定是否静音）
if let aTrack = asset.tracks(withMediaType: .audio).first {
    do {
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: .zero,
                                       duration: CMTime(seconds: min(24, secs), preferredTimescale: 600))
        let output = AVAssetReaderTrackOutput(track: aTrack, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        reader.add(output)
        reader.startReading()
        var peak: Int32 = 0, energy = 0.0, count = 0
        while let sb = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
            let len = CMBlockBufferGetDataLength(block)
            var samples = [Int16](repeating: 0, count: len / 2)
            samples.withUnsafeMutableBytes { raw in
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: len, destination: raw.baseAddress!)
            }
            for v in samples {
                let a = Int32(abs(Int32(v)))
                if a > peak { peak = a }
                energy += Double(v) * Double(v)
                count += 1
            }
        }
        let rms = count > 0 ? sqrt(energy / Double(count)) : 0
        print(String(format: "[verify] audio samples=%d rms=%.1f peak=%d (silent if rms < 20)", count, rms, peak))
    } catch {
        print("[verify] audio read failed: \(error)")
    }
}
