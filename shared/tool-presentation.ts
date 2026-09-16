import { record } from "./contracts.ts";
export function toolPresentation(
  name: string,
  raw?: unknown,
): { label: string; icon: string } {
  let input = raw;
  if (typeof raw === "string") {
    try {
      input = JSON.parse(raw);
    } catch {
      input = {};
    }
  }
  const args = record(input);
  const target = (...keys: string[]) => {
    const value = keys
      .map((key) => args[key])
      .find((value) => typeof value === "string" && value.trim());
    return typeof value === "string"
      ? value.replace(/\s+/g, " ").slice(0, 140)
      : "";
  };
  const file = target("path", "file_path", "filename");
  if (/^(read_file|read_text|file_read)$/.test(name)) {
    return { label: file ? `Read ${file}` : "Read a file", icon: "page" };
  }
  if (/^(write_file|file_write|edit_file|patch_file)$/.test(name)) {
    return {
      label: file ? `Updated ${file}` : "Updated a file",
      icon: "edit-pencil",
    };
  }
  if (/^(web_search|search_web)$/.test(name)) {
    return {
      label: target("query", "q")
        ? `Searched for ${target("query", "q")}`
        : "Searched the web",
      icon: "search",
    };
  }
  if (/^(web_extract|web_fetch|fetch_url)$/.test(name)) {
    const address = target("url");
    let label = "Read a web page";
    try {
      const url = new URL(address);
      label = `Read ${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      /* Keep the generic label for missing or invalid URLs. */
    }
    return { label, icon: "globe" };
  }
  if (/^skill_(view|read|load)$/.test(name)) {
    return {
      label: target("name", "skill", "skill_name")
        ? `Read skill: ${target("name", "skill", "skill_name")}`
        : "Read a skill",
      icon: "page",
    };
  }
  return { label: name.replaceAll("_", " "), icon: "check" };
}
