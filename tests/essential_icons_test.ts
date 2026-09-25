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
    "star",
  ]) {
    equal(choices.has(icon), false, `${icon} is used by Arura`);
  }
  equal(choices.size, essentialIconChoices.length);
  equal(Object.keys(essentialIconSearchData).length, choices.size);
  for (const icon of choices) ok(essentialIconSearchData[icon]);
});
