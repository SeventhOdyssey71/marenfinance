#!/bin/sh
# Xcode Cloud post-clone hook.
#
# WHY THIS IS NEEDED. Maren.xcodeproj is GENERATED from project.yml by xcodegen and is
# deliberately not committed, so that the project file cannot drift from its source of
# truth. Xcode Cloud clones the repo and looks for the project immediately, so without this
# the build fails in about forty seconds with:
#
#   Project Maren.xcodeproj does not exist at apps/ios-native/Maren.xcodeproj
#
# The GitHub Actions workflow solves the same problem with an explicit "Install XcodeGen"
# step; this is that step, in the form Xcode Cloud provides for it.
set -e

cd "$CI_PRIMARY_REPOSITORY_PATH/apps/ios-native"

# Homebrew is present on Xcode Cloud images, but installing from a bottle is slow and its
# availability is not something to depend on for a build that must be reproducible. Prefer
# the pinned release binary and fall back to brew only if the download is unavailable.
# Pinned to the version this repo generates with locally, so CI cannot produce a
# subtly different project file from the same project.yml.
XCODEGEN_VERSION="2.45.4"
if command -v xcodegen >/dev/null 2>&1; then
    echo "xcodegen already present: $(xcodegen --version)"
else
    echo "installing xcodegen $XCODEGEN_VERSION"
    curl -fsSL -o /tmp/xcodegen.zip \
        "https://github.com/yonaskolb/XcodeGen/releases/download/$XCODEGEN_VERSION/xcodegen.zip" \
        && unzip -qo /tmp/xcodegen.zip -d /tmp/xcodegen \
        && export PATH="/tmp/xcodegen/xcodegen/bin:$PATH" \
        || brew install xcodegen
fi

xcodegen generate

# Xcode Cloud builds with automatic package resolution DISABLED and requires a
# Package.resolved to already exist, which the generated project does not carry:
#
#   a resolved file is required when automatic dependency resolution is disabled
#
# The resolve is committed at apps/ios-native/Package.resolved and copied into place here.
# Committing it rather than resolving fresh on CI is the point: it pins all 23 transitive
# dependencies to the versions this app was actually tested against, so a new upstream
# release cannot silently change what ships.
RESOLVED_DIR="Maren.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
mkdir -p "$RESOLVED_DIR"
cp Package.resolved "$RESOLVED_DIR/Package.resolved"

echo "generated:"
ls -d Maren.xcodeproj
echo "pinned dependencies: $(grep -c identity Package.resolved)"
