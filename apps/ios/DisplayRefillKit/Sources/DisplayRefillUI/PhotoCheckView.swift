#if os(iOS)
import AVFoundation
import DisplayRefillCore
import PhotosUI
import SwiftUI
import UIKit

struct PhotoCheckView: View {
    let display: ManualDisplay
    let manualAPI: any ManualScanAPI
    let userID: String
    @State private var model: PhotoWorkflow
    @State private var selection: PhotosPickerItem?
    @State private var camera = false
    @State private var polling: Task<Void, Never>?
    @AccessibilityFocusState private var noticeFocused: Bool
    @Environment(\.scenePhase) private var scenePhase
    init(api: any PhotoScanAPI, manualAPI: any ManualScanAPI, display: ManualDisplay, userID: String) {
        self.display = display; self.manualAPI = manualAPI; self.userID = userID
        _model = State(initialValue: PhotoWorkflow(api: api, display: display, userID: userID))
    }
    var body: some View {
        ScrollViewReader { reader in
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Photograph the whole display straight on. Include every shelf; avoid glare, people and hidden stock. Match the reference outline. Cropping does not correct perspective or prove countability.")
                if let reference = model.reference {
                    Text("Pinned display reference").font(.headline)
                    AsyncImage(url: reference.url) { image in image.resizable().scaledToFit() } placeholder: { Text("Loading reference…") }
                        .aspectRatio(CGFloat(reference.width)/CGFloat(reference.height), contentMode: .fit)
                        .accessibilityLabel("Reference display photograph")
                    Text("Reference aspect: \(reference.width) by \(reference.height). Match these display bounds in your photo.")
                }
                if let message = model.message { Text(message).accessibilityIdentifier("photo-notice").id("photo-notice").accessibilityFocused($noticeFocused) }
                if let data = model.jpeg, let image = UIImage(data: data) {
                    Text("Upright photo and display bounds").font(.headline)
                    Image(uiImage: image).resizable().aspectRatio(image.size.width/image.size.height, contentMode: .fit)
                        .overlay {
                            GeometryReader { geometry in
                                Rectangle().stroke(.yellow, lineWidth: 3)
                                    .frame(width: geometry.size.width * model.crop.width, height: geometry.size.height * model.crop.height)
                                    .position(x: geometry.size.width * (model.crop.x+model.crop.width/2), y: geometry.size.height * (model.crop.y+model.crop.height/2))
                            }
                        }
                        .accessibilityLabel("Upright photo preview. Yellow outline shows the selected display crop.")
                        .accessibilityIdentifier("photo-preview")
                    // Numeric percentages are relative to the image content itself, never a letterboxed viewport.
                    cropSlider("Left", value: $model.crop.x, range: 0...max(0,1-model.crop.width))
                    cropSlider("Top", value: $model.crop.y, range: 0...max(0,1-model.crop.height))
                    cropSlider("Width", value: $model.crop.width, range: 0.05...max(0.05,1-model.crop.x))
                    cropSlider("Height", value: $model.crop.height, range: 0.05...max(0.05,1-model.crop.y))
                    if !model.finished {
                        Button(model.locked ? "Retry photo submission" : "Upload selected display photo") {
                            Task { await model.submit(); if model.finished { startPolling() } }
                        }
                        .disabled(model.busy)
                    }
                }
                if model.busy { ProgressView("Saving…") }
                analysisSection
                PhotosPicker(selection: $selection, matching: .images, photoLibrary: .shared()) {
                    Label(model.jpeg == nil ? "Import photo" : "Import another photo (new scan)", systemImage: "photo")
                }.disabled(model.busy)
                Button(model.jpeg == nil ? "Take photo" : "Retake photo (new scan)") { Task { await openCamera() } }.disabled(model.busy)
                if AVCaptureDevice.authorizationStatus(for: .video) == .denied {
                    Button("Open camera settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                }
                NavigationLink("Start manual check") { ManualCheckView(api: manualAPI, userID: userID, display: display, scanID: nil) }
                Text("A manual check is always available and calculates refill quantities on the server.")
            }
            .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
            .padding()
        }
        .onChange(of: model.message) { _, message in
            if message != nil { reader.scrollTo("photo-notice", anchor: .top); noticeFocused = true }
        }
        }
        .buttonStyle(PhotoActionStyle())
        .navigationTitle("Photo check")
        .task { await model.loadReference() }
        .onAppear { if model.finished { startPolling() } }
        .onDisappear { polling?.cancel() }
        .onChange(of: model.analysis) { _, state in
            if let text = Self.statusText(state) { AccessibilityNotification.Announcement(text).post() }
        }
        .onChange(of: selection) { _, item in
            guard let item else { return }
            // Clear it so choosing the same library photo again (for a new scan) still triggers an import.
            selection = nil
            Task {
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else { return }
                    let normalized = try await Task.detached { try PhotoImage.normalize(data) }.value
                    model.setPhoto(normalized)
                } catch { model.notice("This photo could not be imported. Choose a still JPEG or HEIC photo, retake, or use manual mode.") }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Backgrounding stops polling; the durable server job continues and foreground resumes by scan ID.
            if phase == .active { Task { await model.loadReference() }; if model.finished { startPolling() } } else { polling?.cancel() }
        }
        .sheet(isPresented: $camera) {
            CameraView(referenceAspect: model.reference.map { CGFloat($0.width)/CGFloat($0.height) } ?? 1) { data in
                camera = false
                if let data {
                    Task {
                        do { model.setPhoto(try await Task.detached { try PhotoImage.normalize(data) }.value) }
                        catch { model.notice("Capture could not be read. Retake or import a photo.") }
                    }
                } else { model.notice("Camera closed without a usable photo. Retake, import or use manual mode.") }
            }
        }
    }
    @ViewBuilder private var analysisSection: some View {
        if let status = Self.statusText(model.analysis) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Photo analysis").font(.headline).accessibilityAddTraits(.isHeader)
                if case .waiting = model.analysis { ProgressView().accessibilityHidden(true) }
                Text(status).accessibilityIdentifier("analysis-status")
                switch model.analysis {
                case .reviewReady(let summary):
                    if summary.synthetic {
                        Label("Test analysis: these estimates come from a synthetic test provider, not from your photo.", systemImage: "exclamationmark.triangle")
                            .accessibilityIdentifier("analysis-synthetic")
                    }
                    Text("Estimates are not confirmed counts. Check each estimate that needs it, correct any wrong number, then confirm.")
                case .failed(_, let retryAvailable):
                    if retryAvailable { Button("Retry analysis") { Task { await model.retryAnalysis(); startPolling() } }.disabled(model.busy) }
                default: EmptyView()
                }
                if model.reviewAvailable, let id = model.scanID {
                    NavigationLink(model.analysis.isReviewReady ? "Review estimates and counts" : "Enter counts for this scan") {
                        ManualCheckView(api: manualAPI, userID: userID, display: display, scanID: id)
                    }
                }
                if model.takeoverAvailable {
                    Button("Stop analysis and enter counts for this scan") { Task { await model.takeOver() } }
                        .disabled(model.busy)
                    Text("Keeps this photo with the scan. Any analysis result that arrives later is ignored.")
                }
            }
        }
    }
    /// Plain-language state; also announced to VoiceOver when it changes.
    static func statusText(_ state: AnalysisState) -> String? {
        switch state {
        case .notSubmitted: return nil
        case .waiting(let processing, let delayed):
            let base = processing ? "Analysing photo." : "Photo queued for analysis."
            return delayed ? base + " This is taking longer than usual. Keep waiting, or start a manual check." : base
        case .unreachable(let delayed):
            return "Can't reach the server to check analysis. It continues on the server; this screen retries automatically." + (delayed ? " You can start a manual check." : "")
        case .reviewReady(let s):
            if s.alignmentUnclear { return "We couldn't match this photo to the layout. Retake or enter counts." }
            var text = "Analysis finished: \(s.estimated) of \(s.total) slots have estimates; \(s.needsVerification) need verification."
            if !s.imageFlags.isEmpty { text += " Photo quality issues: \(s.imageFlags.joined(separator: ", "))." }
            return text
        case .failed(_, let retryAvailable):
            return retryAvailable ? "We couldn't analyse this photo. Retry or enter counts manually." : "We couldn't analyse this photo. Enter counts manually or retake with a new scan."
        case .manual: return "This scan continues as a manual check."
        }
    }
    private func startPolling() {
        polling?.cancel()
        polling = Task { await model.pollAnalysis() }
    }
    private func cropSlider(_ label: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading) {
            Text("\(label): \(Int(value.wrappedValue*100)) percent")
            // A stepped Slider over a collapsed range (e.g. Left while Width is 100%) is a SwiftUI
            // precondition failure, so an edge with no room to move shows guidance instead.
            if range.upperBound - range.lowerBound >= 0.01 {
                Slider(value: value, in: range, step: 0.01).accessibilityLabel("Crop \(label)").accessibilityValue("\(Int(value.wrappedValue*100)) percent")
            } else {
                Text(label == "Left" || label == "Top" ? "Reduce the \(label == "Left" ? "width" : "height") to move this edge." : "Move the opposite edge to change this size.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.disabled(model.locked || model.busy)
    }
    private func openCamera() async {
        let allowed = await AVCaptureDevice.requestAccess(for: .video)
        guard allowed else { model.notice("Camera permission denied. Import from Photos, enable camera in Settings, or use a manual check."); return }
        guard AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil else {
            model.notice("No camera is available. Import a photo or use manual mode."); return
        }
        camera = true
    }
}

private struct PhotoActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.lineLimit(nil).fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 44, alignment: .leading)
            .foregroundStyle(enabled ? Color.accentColor : Color.secondary)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// AVFoundation work is confined to a serial queue, outside the SwiftUI body/main thread.
protocol CameraCapturing: Sendable {
    var session: AVCaptureSession { get }
    func start()
    func stop()
    func capture(angle: CGFloat)
}
final class CameraCapture: NSObject, CameraCapturing, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "display-refill.camera")
    private let completion: @MainActor @Sendable (Data?) -> Void
    init(completion: @escaping @MainActor @Sendable (Data?) -> Void) { self.completion = completion }
    func start() {
        queue.async { [self] in
            session.beginConfiguration(); session.sessionPreset = .photo
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input), session.canAddOutput(output) else {
                session.commitConfiguration(); Task { @MainActor in completion(nil) }; return
            }
            session.addInput(input); session.addOutput(output); session.commitConfiguration(); session.startRunning()
        }
    }
    func stop() { queue.async { [self] in session.stopRunning() } }
    func capture(angle: CGFloat) {
        queue.async { [self] in
            if let connection = output.connection(with: .video) {
                if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
            }
            output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: (any Error)?) {
        let data = error == nil ? photo.fileDataRepresentation() : nil
        Task { @MainActor in completion(data) }
    }
}
struct CameraView: UIViewControllerRepresentable {
    let referenceAspect: CGFloat
    let completion: @MainActor @Sendable (Data?) -> Void
    func makeUIViewController(context: Context) -> CameraController { CameraController(referenceAspect: referenceAspect, completion: completion) }
    func updateUIViewController(_ uiViewController: CameraController, context: Context) {}
    static func dismantleUIViewController(_ controller: CameraController, coordinator: ()) { controller.capture.stop() }
}
final class CameraController: UIViewController {
    let capture: CameraCapture
    private var preview: AVCaptureVideoPreviewLayer!
    private let referenceAspect: CGFloat
    private let completion: @MainActor @Sendable (Data?) -> Void
    init(referenceAspect: CGFloat, completion: @escaping @MainActor @Sendable (Data?) -> Void) {
        self.referenceAspect = referenceAspect; self.completion = completion
        capture = CameraCapture(completion: completion); super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        preview = AVCaptureVideoPreviewLayer(session: capture.session); preview.videoGravity = .resizeAspect
        view.layer.addSublayer(preview)
        let outline = UIView(); outline.layer.borderColor = UIColor.systemYellow.cgColor; outline.layer.borderWidth = 3
        outline.isUserInteractionEnabled = false; outline.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(outline)
        let guidance = UILabel(); guidance.text = "Match the whole display inside this reference outline. Adjust the crop after capture."
        guidance.font = .preferredFont(forTextStyle: .body); guidance.adjustsFontForContentSizeCategory = true
        guidance.numberOfLines = 0; guidance.textColor = .label; guidance.backgroundColor = .systemBackground
        guidance.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(guidance)
        let cancel = UIButton(type: .system); cancel.setTitle("Cancel camera", for: .normal)
        cancel.titleLabel?.font = .preferredFont(forTextStyle: .body); cancel.titleLabel?.adjustsFontForContentSizeCategory = true
        cancel.backgroundColor = .systemBackground; cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addTarget(self, action: #selector(cancelCamera), for: .touchUpInside); view.addSubview(cancel)
        NSLayoutConstraint.activate([
            outline.centerXAnchor.constraint(equalTo: view.centerXAnchor), outline.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            outline.widthAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.widthAnchor, multiplier: 0.85),
            outline.heightAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.heightAnchor, multiplier: 0.5),
            outline.widthAnchor.constraint(equalTo: outline.heightAnchor, multiplier: referenceAspect),
            guidance.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            guidance.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            guidance.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            cancel.topAnchor.constraint(equalTo: guidance.bottomAnchor, constant: 8), cancel.leadingAnchor.constraint(equalTo: guidance.leadingAnchor), cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
        let preferred = outline.widthAnchor.constraint(equalTo: view.safeAreaLayoutGuide.widthAnchor, multiplier: 0.85); preferred.priority = .defaultHigh; preferred.isActive = true
        let button = UIButton(type: .system); button.setTitle("Capture display", for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline); button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.backgroundColor = .systemBackground; button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(shoot), for: .touchUpInside); view.addSubview(button)
        NSLayoutConstraint.activate([button.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16), button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16), button.heightAnchor.constraint(greaterThanOrEqualToConstant: 60)])
        capture.start()
    }
    private var rotationAngle: CGFloat {
        switch view.window?.windowScene?.interfaceOrientation {
        case .landscapeLeft: 180
        case .landscapeRight: 0
        case .portraitUpsideDown: 270
        default: 90
        }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); preview.frame = view.bounds
        if let connection = preview.connection, connection.isVideoRotationAngleSupported(rotationAngle) { connection.videoRotationAngle = rotationAngle }
    }
    @objc private func shoot() { capture.capture(angle: rotationAngle) }
    @objc private func cancelCamera() { completion(nil) }
}
#endif
