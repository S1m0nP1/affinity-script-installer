// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AffinityHubMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "AffinityHubMac", targets: ["AffinityHubMac"])
    ],
    targets: [
        .executableTarget(
            name: "AffinityHubMac",
            swiftSettings: [
                .swiftLanguageMode(.v5),
                .unsafeFlags(["-parse-as-library"])
            ]
        )
    ]
)
