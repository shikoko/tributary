/** What kind of file a path is, by its extension or its name, for the icon next to it. */
export type FileKind =
  | "image"
  | "audio"
  | "video"
  | "model"
  | "engine"
  | "code"
  | "data"
  | "text"
  | "archive"
  | "font"
  | "program"
  | "folder"
  | "file";

const BY_EXTENSION: Record<Exclude<FileKind, "folder" | "file">, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tga", "tif", "tiff", "psd", "exr", "hdr", "dds", "avif", "heic", "kra", "xcf"],
  audio: ["wav", "mp3", "ogg", "oga", "opus", "flac", "m4a", "aac", "aif", "aiff", "wma", "mid", "midi"],
  video: ["mp4", "m4v", "webm", "mov", "avi", "mkv", "wmv"],
  model: ["glb", "gltf", "obj", "fbx", "stl", "ply", "blend", "dae", "3ds", "max", "ma", "mb", "usd", "usda", "usdc", "usdz", "abc"],
  engine: ["uasset", "umap", "uexp", "ubulk", "upk", "unity", "prefab", "mat", "anim", "controller", "asset", "tscn", "tres"],
  code: [
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "go", "py", "rb", "java", "kt", "kts", "swift", "c", "h", "cpp", "hpp", "cc", "cxx",
    "cs", "m", "mm", "php", "lua", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "vue", "svelte", "dart", "scala", "ex", "exs",
    "erl", "hs", "clj", "gd", "shader", "hlsl", "glsl", "usf", "ush", "html", "htm", "css", "scss", "sass", "less", "zig", "nim", "r",
  ],
  data: ["json", "jsonc", "json5", "yaml", "yml", "toml", "xml", "csv", "tsv", "ini", "cfg", "conf", "env", "lock", "plist", "properties", "uproject", "uplugin", "meta"],
  text: ["md", "markdown", "txt", "rst", "adoc", "pdf", "doc", "docx", "rtf", "log", "odt"],
  archive: ["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz", "zst", "pak"],
  font: ["ttf", "otf", "woff", "woff2"],
  program: ["exe", "dll", "so", "dylib", "bin", "wasm", "msi", "dmg", "apk", "lib", "a", "o", "pdb"],
};

const KIND_OF = new Map<string, FileKind>(
  Object.entries(BY_EXTENSION).flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind as FileKind])),
);

/** Files known by their whole name. */
const BY_NAME: Record<string, FileKind> = {
  dockerfile: "code",
  makefile: "code",
  justfile: "code",
  ".gitignore": "data",
  ".gitattributes": "data",
  ".gitmodules": "data",
  ".editorconfig": "data",
  license: "text",
  readme: "text",
  changelog: "text",
};

export function fileKind(path: string): FileKind {
  if (path.endsWith("/")) return "folder";
  const name = (path.split("/").pop() ?? path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return BY_NAME[name.split(".")[0]] ?? "file";
  return KIND_OF.get(name.slice(dot + 1)) ?? BY_NAME[name.slice(0, dot)] ?? "file";
}

/** What people call each kind, for the icon's tooltip. */
export const KIND_LABELS: Record<FileKind, string> = {
  image: "Picture",
  audio: "Sound",
  video: "Video",
  model: "3D model",
  engine: "Game engine asset",
  code: "Code",
  data: "Data or settings",
  text: "Text",
  archive: "Archive",
  font: "Font",
  program: "Program or library",
  folder: "Folder",
  file: "File",
};
