// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AffinityHubMacTest",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "AffinityHubMacTest", targets: ["AffinityHubMacTest"])
    ],
    targets: [
        .executableTarget(
            name: "AffinityHubMacTest",
            swiftSettings: [
                .swiftLanguageMode(.v5),
                .unsafeFlags(["-parse-as-library"])
            ]
        )
    ]
)
