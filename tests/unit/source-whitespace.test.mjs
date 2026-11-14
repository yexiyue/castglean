import assert from "node:assert/strict";
import { test } from "vitest";
import { blankRuns, mergeBlankRuns, isBlankSourceLine, blankRunHeight } from "../../src/lib/projects/source-whitespace.ts";
test("only whitespace lines collapse; indentation, poetry, ASCII and zero-width content remain source text",()=>{
 for(const text of ["", "\r\n", "　\t \r\n", "\u00a0\n", "\ufeff\r\n"])assert.equal(isBlankSourceLine(text),true);
 for(const text of ["　　正文", "  x\t y", "| 1 | 2 |", "\u200b"])assert.equal(isBlankSourceLine(text),false);
});
test("blank runs keep absolute line ranges and merge across short read blocks without mutating metadata",()=>{
 const first=blankRuns([{line:27,text:"\r\n"},{line:28,text:"\u00a0\r\n"},{line:29,text:"\t\r\n"}]);
 const second=blankRuns([{line:30,text:"　\r\n"},{line:31,text:"正文"},{line:32,text:"\r\n"}]);
 const original=structuredClone(first);const merged=mergeBlankRuns([...first,...second]);
 assert.deepEqual(merged,[{from:27,to:31},{from:32,to:33}]);assert.deepEqual(first,original);
 assert.equal(blankRunHeight(merged[0]),24);assert.equal(blankRunHeight(merged[1]),12);
});
test("a gap in source lines or a fresh chapter scope never merges unrelated whitespace",()=>{
 assert.deepEqual(mergeBlankRuns([{from:0,to:2},{from:3,to:5}]),[{from:0,to:2},{from:3,to:5}]);
 assert.deepEqual(blankRuns([{line:0,text:"\r\n"},{line:3,text:"\r\n"}]),[{from:0,to:1},{from:3,to:4}]);
 assert.deepEqual(mergeBlankRuns(blankRuns([{line:0,text:"\r\n"} ])),[{from:0,to:1}]);
});
