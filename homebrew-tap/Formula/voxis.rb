class Voxis < Formula
  desc "Private voice dictation engine (Tauri + Rust)"
  homepage "https://voxis.top"
  url "https://voxis.top/dist/voxis-macos-universal.tar.gz"
  version "0.1.0"
  sha256 "TODO"

  def install
    bin.install "voxis-macos-universal" => "voxis"
  end

  test do
    system "#{bin}/voxis", "--version"
  end
end
