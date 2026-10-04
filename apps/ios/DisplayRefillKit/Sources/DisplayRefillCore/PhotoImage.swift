#if os(iOS)
import Foundation
import ImageIO
import UIKit

public enum PhotoImageError: Error { case unreadable, tooLarge }
public enum PhotoImage {
    /// ImageIO applies all eight EXIF orientations (including mirrored axes) before JPEG encoding.
    /// A fresh destination contains pixels only, with no source EXIF/GPS dictionaries copied.
    public static func normalize(_ data: Data) throws -> Data {
        guard data.count <= 50 * 1024 * 1024 else { throw PhotoImageError.tooLarge }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) == 1,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2048,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw PhotoImageError.unreadable }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, "public.jpeg" as CFString, 1, nil) else { throw PhotoImageError.unreadable }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination), output.length <= 10 * 1024 * 1024 else { throw PhotoImageError.tooLarge }
        return output as Data
    }
}
#endif
