/*
  =============================================================================
  RegExp Named Capturing Groups polyfill
  =============================================================================

  Only work with RegExp(...), polyfill with literal notation is impossible.

    working:                            // /Foo(?<bar>bar)/i
      RegExp("Foo(?<bar>bar)", "i")
      RegExp(RegExp("Foo(?<bar>bar)"), "i")

    not working:                        // SyntaxError: invalid regexp group
      /Foo(?<bar>bar)/i
      RegExp(/Foo(?<bar>bar)/, "i")

  =============================================================================
  The MIT License (MIT)
  =============================================================================

  Copyright (c) 2017- Commenthol
  https://github.com/commenthol/named-regexp-groups
  Copyright (c) 2017- lifaon74
  https://github.com/lifaon74/regexp-polyfill
  Copyright (c) 2022- SeaHOH
  https://github.com/SeaHOH
  Copyright (c) 2022- Martok
  https://github.com/martok


  Permission is hereby granted, free of charge, to any person obtaining a copy of
  this software and associated documentation files (the "Software"), to deal in
  the Software without restriction, including without limitation the rights to
  use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
  of the Software, and to permit persons to whom the Software is furnished to do
  so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
*/

// Conditionals for terser
const CC_HOST = true;
const CC_RUNTIME = true;
const CC_USED_ARG = (function () {
    // RegExp Scanner

    const
        S_NAME = "([a-zA-Z_$][a-zA-Z_$0-9]{0,50})",
        R_NAMED_GROUP = new RegExp("\\?<" + S_NAME + ">", "y"),
        R_NONCAPTURING = /\?[:!=]/y,
        R_NAMED_BACKREF = new RegExp("\\\\k<" + S_NAME + ">", "y"),
        R_NAME_REPLACE = new RegExp("\\$<" + S_NAME + ">", "g"),
        R_RE_MODIFIERS = /\/([dgimsuy]*)([.,;)}\]\s]|$)/y,
        R_UNIESCAPE = /\\([pP])({([a-zA-Z_]+)}|.)/y,
        MAX_RE_LEN = 1000,
        A_FLAGS = [... "dgimsuy"],
        dotAllBroken = (() => {
                try {new RegExp("", "s")} catch(e) {return true}
                return false;
            })();

    RegExp.prototype._execAt = function (str, at) {
        this.lastIndex = at;
        return this.exec(str);
    }

    RegExp.prototype._testAt = function (str, at) {
        this.lastIndex = at;
        return this.test(str);
    }

    class RegExpScanner {
        constructor(source, start=0) {
            this.source = source;
            this.start = start;
            this.parens = [];
            this.specialchars = [];
        }

        get escapedPattern() {
            return this.pattern.replace(/[\\"]/g, "\\$&");
        }

        scan(locateEnd=false) {
            const end = this._scanToEnd(locateEnd);
            if (end === false) {
                return false;
            }
            this.pattern = this.source.substring(this.start, end);
            this.lastIndex = end;
            if (locateEnd) {
                // end is the final / of the expression, check if there are flags
                const modifiers = R_RE_MODIFIERS._execAt(this.source, end);
                if (modifiers === null) {
                    return false;
                }
                this.flags = modifiers[1];
                this.lastIndex += modifiers[0].length - modifiers[2].length;
            }
            return true;
        }

        _scanToEnd(locateEnd) {
            const source = this.source;
            const start = this.start;
            let p = start;
            let inCC = false;
            let groupBegins = [];
            while (p<source.length && p-start<MAX_RE_LEN) {
                switch(source.charAt(p)) {
                    case "[":
                        inCC = true;
                        break;
                    case "]":
                        inCC = false;
                        break;
                    case "(":
                        groupBegins.push(p);
                        break;
                    case ")":
                        const beg = groupBegins.pop();
                        if (typeof beg == "undefined") {
                            return false;
                        }
                        this.parens.push([beg-start, p-start]);
                        break;
                    case ".":
                        this.specialchars.push([p - 1 - start, inCC]);
                        break;
                    case "\\":
                        if (p<source.length-1) {
                            p++;
                            if ("pPk".indexOf(source.charAt(p)) != -1) {
                                this.specialchars.push([p - 1 - start, inCC]);
                            }
                        } else {
                            // reached a syntax error
                            return false;
                        }
                        break;
                    case "/":
                        if (locateEnd) {
                            if (!inCC)
                                return p;
                        } else {
                            // if we weren't supposed to locate the end, finding one is an error
                            return false;
                        }
                        break;
                    case "\r":
                    case "\n":
                        return false;
                }
                p++;
            }
            if (locateEnd) {
                return false;
            } else {
                return p;
            }
        }

        shouldRewritePattern() {
            // does this RE use anything obviously unsupported?
            // assumes that we did scan flags
            for (const p of this.specialchars) {
                if (this.pattern.charAt(p) == ".") {
                    // have to fix dot=newline?
                    if (this.flags.indexOf("s")>=0)
                        return true;
                } else
                    // other specialchars all require work
                    return true;
            }
            // any named groups?
            for (const [lpar, rpar] of this.parens) {
                if (R_NAMED_GROUP._execAt(this.pattern, lpar + 1)) {
                    return true;
                }
            }
            return false;
        }

        generateGroups() {
            this.groups = [-1];
            this.names = {};

            this.parens.sort((a, b) => a[0] - b[0]);
            this.parens.map(([lpar, rpar], p) => {
                // is it a real group, not a cluster (?:...), or assertion (?=...), (?!...)
                if (R_NONCAPTURING._testAt(this.pattern, lpar + 1))
                    return;
                this.groups.push(p);
                // is it a named capture group?
                const name = R_NAMED_GROUP._execAt(this.pattern, lpar + 1);
                if (name && name[1]) {
                    this.names[name[1]] = this.groups.length - 1;
                }
            });
        }
    }


    if (CC_RUNTIME) {
        // Unicode Support

        function translateUnicodeEscape(name, inverted, inCC) {
            return null;
        }

        // Main RegExp Rewriting

        function transpile(source, fixDotAll, allowUnicodeEscape) {
            function splice(first, last, newContent="") {
                scanner.pattern = scanner.pattern.substring(0, first) + newContent + scanner.pattern.substring(last + 1);
                const lenchange = newContent.length - (last-first+1);
                // adjust pointers in scanner to new string
                scanner.parens = scanner.parens.map(([lpar, rpar], p) => {
                    if (rpar < first)
                        return [lpar, rpar];                        // unaffected
                    if (lpar >= first && rpar <= last)
                        return undefined;                           // completely removed
                    if (lpar < first)
                        return [lpar, rpar + lenchange];            // left unchanged, right moved
                    return [lpar + lenchange, rpar + lenchange];    // both shifted
                });
                scanner.specialchars = scanner.specialchars.map(([p, inCC]) => {
                    if (p < first)
                        return [p, inCC];                           // unaffected
                    if (p >= first && p <= last)
                        return undefined;                           // completely removed
                    return [p + lenchange, inCC];                   // shifted
                }).filter(a => typeof a !== "undefined");
            }
            // Step 1. scan regexp for all features
            const scanner = new RegExpScanner(source);
            scanner.scan(false);
            scanner.generateGroups();
            // Step 2. remove group names
            for (const [name, group] of Object.entries(scanner.names)) {
                const [lpar, rpar] = scanner.parens[scanner.groups[group]];
                splice(lpar + 1, lpar + 3 + name.length);
            }
            // Step 3. process special chars
            let match = null;
            for (const [loc, inCC] of scanner.specialchars) {
                if (fixDotAll && scanner.pattern.charAt(loc) == ".") {
                    splice(loc, loc, inCC ? "\\s\\S" : "[\\s\\S]");
                    continue;
                }
                match = R_NAMED_BACKREF._execAt(scanner.pattern, loc);
                if (match != null) {
                    const idx = scanner.names[match[1]];
                    splice(loc, match.index + match[0].length - 1, "\\" + idx);
                    continue;
                }
                if (allowUnicodeEscape) {
                    match = R_UNIESCAPE._execAt(scanner.pattern, loc);
                    if (match != null) {
                        const rep = translateUnicodeEscape(match[3] || match[2], match[1] == "P", inCC);
                        if (rep != null)
                            splice(loc, match.index + match[0].length - 1, rep);
                        continue;
                    }
                }
            }
            return {source: scanner.pattern, groups: scanner.names};
        }

        // NamedRegExp Runtime

        const NativeRegExp = RegExp;
        class NamedRegExp extends NativeRegExp {
            constructor(pattern, flags) {
                if (pattern instanceof NamedRegExp) {
                    pattern = pattern.source;
                    flags = flags || pattern.flags;
                }
                flags = flags || "";
                const
                    cflags = flags.replace("s", ""),
                    dotall = cflags !== flags;
                if (!(dotall && dotAllBroken) && pattern instanceof NativeRegExp)
                    return super(pattern, flags);
                let {source, groups} = transpile(pattern, dotAllBroken && dotall, flags.indexOf("u")>=0);
                const named = Object.keys(groups).length > 0;
                super(source, cflags);
                this._source = pattern;
                this._dotall = dotall;
                this._groups = groups;
                this._named = named;
                this._flags = A_FLAGS.map((flag) => {
                        return flags.includes(flag) ? flag : "";
                    }).join("");
            }
            get source() {
                return this._source;
            }
            get dotAll() {
                return this._dotall;
            }
            get flags() {
                return this._flags;
            }
            _updateGroups(res) {
                if (res && this._named) {
                    res.groups = {};
                    Object.entries(this._groups).forEach(([name, index]) => {
                        res.groups[name] = res[index];
                    });
                    return res.groups;
                }
            }
            exec(str) {
                const res = super.exec(str);
                this._updateGroups(res);
                return res;
            }
            [Symbol.replace](str, replacement) {
                let repl = replacement
                switch (typeof replacement) {
                    case "string":
                        const groups = this._groups;
                        repl = replacement.replace(R_NAME_REPLACE, (_, name) => {
                            const index = groups[name];
                            return [undefined, null].includes(index) ? "" : "$" + index;
                        });
                        break;
                    case "function":
                        if (this._named) {
                            repl = ((...args) => {
                                    args.push(this._updateGroups(args));
                                    return replacement.apply(this, args);
                                }).bind(this);
                        } else {
                            repl = replacement.bind(this);
                        }
                        break;
                    default:
                        return String(repl);
                }
                return super[Symbol.replace](str, repl);
            }
        }

        function hasES2018Regex() {
            // assume that if we have named capturing groups, we have a modern RE engine
            try {new RegExp("(?<foo>foo)"); return true} catch(e) {}
            return false;
        }

        // install to global context
        if (!hasES2018Regex()) {
            globalThis.RegExp = function RegExp(pattern, flags) {
                return new NamedRegExp(pattern, flags);
            }
            globalThis.RegExp.prototype = NativeRegExp.prototype;
            globalThis.NativeRegExp = NativeRegExp;
        }
    }

    if (CC_HOST) {
        const NamedRegExpShim = class {
            static replaceRegExpLiterals(source) {
                const R_RE_START = /(^|return|throw|[=,;({[\s])\//gm,
                      R_NEEDS_REPLACE = /\(\?<|\\p|\\P/,
                      MAX_RE_LEN = 1000;

                const searchFrom = (index, re) => {
                    re.lastIndex = index;
                    return re.exec(source);
                };

                let cursor = 0;
                let processed = [];
                while (cursor < source.length) {
                    const tokBegin = searchFrom(cursor, R_RE_START);
                    if (tokBegin === null) {
                        // no more regexp literals, done
                        processed.push(source.substring(cursor));
                        break;
                    }
                    // got a new probable match, consume up to here
                    processed.push(source.substring(cursor, tokBegin.index));
                    cursor = tokBegin.index;
                    // try scanning a regex here
                    const scanner = new RegExpScanner(source, tokBegin.index + tokBegin[0].length);
                    if (!scanner.scan(true)) {
                        // not a regex, continue after the failed begin token
                        processed.push(tokBegin[0]);
                        cursor += tokBegin[0].length;
                    } else {
                        // is a regex, check if we need to modify it at all
                        if (scanner.shouldRewritePattern()) {
                            processed.push(source.substring(cursor, tokBegin.index));
                            processed.push(tokBegin[1]+'(RegExp("'+scanner.escapedPattern+'","'+scanner.flags+'"))');
                            cursor = scanner.lastIndex;
                        } else {
                            // no special features, leave it as is
                            processed.push(source.substring(cursor, scanner.lastIndex))
                            cursor = scanner.lastIndex;
                        }
                    }
                }

                return processed.join("");
            }
        }
        if (CC_RUNTIME) {
            globalThis.NamedRegExpShim = NamedRegExpShim;
        }
        return NamedRegExpShim;
    }
}());
