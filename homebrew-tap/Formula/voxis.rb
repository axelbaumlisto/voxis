class Voxis < Formula
  desc "Private voice dictation engine (Tauri + Rust)"
  homepage "https://voxis.top"
  url "https://github.com/axelbaumlisto/voxis/releases/download/v0.1.0/voxis-macos-arm64.tar.gz"
  version "0.1.0"
  sha256 "914a285942076e4a28ac7d9bf6bf9a3591eddfbf7710697923cd135f989c5904"
  depends_on arch: :arm64

  def install
    bin.install "voxis-macos-arm64" => "voxis"
  end

  test do
    system "#{bin}/voxis", "--version"
  end
end
