import { deepStrictEqual, equal, ok } from "node:assert/strict";
import {
  essentialIconChoices,
  searchEssentialIcons,
} from "../shared/essentialIcons.ts";
import { essentialIconSearchData } from "../shared/essentialIconSearchData.ts";

Deno.test("Essentials search finds related concepts and combines terms", () => {
  const labels = (query: string) =>
    searchEssentialIcons(query).map(([, label]) => label);
  deepStrictEqual(labels("caffeine"), ["Coffee"]);
  deepStrictEqual(labels("cinema"), ["Movies"]);
  deepStrictEqual(labels("writing diary"), ["Journal"]);
  deepStrictEqual(labels("pet"), ["Wolf"]);
  deepStrictEqual(labels("unrelated nonsense"), []);
  equal(searchEssentialIcons("  ").length, essentialIconChoices.length);
  ok(essentialIconChoices.length > 82);
  const ids = (query: string) =>
    new Set<string>(searchEssentialIcons(query).map(([icon]) => icon));
  for (const [query, icon] of [
    ["arc3d", "arc-3d"],
    ["physical object", "cube-scan"],
    ["money", "coins"],
    ["vehicle", "truck"],
    ["sky", "sun-light"],
    ["factory", "industry"],
    ["biometric", "iris-scan"],
    ["waveform", "sine-wave"],
    ["sparkle", "spark-solid"],
  ]) {
    ok(ids(query).has(icon), `${query} should find ${icon}`);
  }
});

Deno.test("Essentials picker excludes application control icons", () => {
  const choices = new Set<string>(essentialIconChoices.map(([icon]) => icon));
  for (const icon of [
    "bot",
    "brain",
    "clock",
    "edit-pencil",
    "eye",
    "folder",
    "message-text",
    "network",
    "search",
    "send",
    "settings",
    "star",
    "calendar",
    "puzzle",
    "windows",
  ]) {
    equal(choices.has(icon), false, `${icon} is used by Arura`);
  }
  equal(choices.size, essentialIconChoices.length);
  equal(Object.keys(essentialIconSearchData).length, choices.size);
  for (const icon of choices) ok(essentialIconSearchData[icon]);
});

Deno.test("requested Icons exist as local SVG assets", async () => {
  const icons = new Set<string>(essentialIconChoices.map(([icon]) => icon));
  for (const icon of [
    "spark-solid",
    "arc-3d",
    "cube-scan",
    "arrow-archery",
    "industry",
    "iris-scan",
    "sine-wave",
    "cylinder",
    "fillet-3d",
    "dashboard-speed",
    "dashboard",
    "control-slider",
    "dashboard-dots",
    "sigma-function",
    "asterisk",
    "barcode",
    "flare",
    "hexagon",
    "cooling-square-solid",
    "depth",
    "dna",
    "infinite",
    "magnet-solid",
    "moon-sat",
    "radiation-solid",
    "square-wave",
  ]) {
    ok(icons.has(icon), `${icon} is missing from the picker`);
    const svg = await Deno.readTextFile(
      new URL(`../src/icons/${icon}.svg`, import.meta.url),
    );
    ok(svg.startsWith("<svg "), `${icon} is not an SVG`);
    ok(svg.includes("currentColor"), `${icon} does not follow thread color`);
  }
});
