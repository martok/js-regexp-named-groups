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
(function () {
    // do nothing if everything is already supported
    try {new RegExp("(?<foo>foo)"); return} catch(e) {}

    const
        S_NAME = "([a-zA-Z_$][a-zA-Z_$0-9]{0,50})",
        R_NAME_REPLACE = new RegExp("\\$<" + S_NAME + ">", "g"),
        R_NAMED_BACKREF = new RegExp("^[?:]&" + S_NAME),
        R_GROUP = new RegExp("^[?:]<" + S_NAME + ">([^]*)"),
        R_GROUPS = /(\\?[()])/g,
        R_EMPTY_GROUPS = /([^\\]|^)\(\)/g,
        A_FLAGS = [... "dgimsuy"],
        dotAllBroken = (() => {
                try {new RegExp("", "s")} catch(e) {return true}
                return false;
            })();
    function generate (str) {
        const
            groups = {},
            named = {},
            arr = String(str).split(R_GROUPS),
            store = {
                count: 0,     // counter for unnamed matching group
                groups: [""], // store for named pattern
                names: []     // store for names of capture groups
            };
        let index = 0, source = arr.map((part, i) => {
            let name, block, isGroup = false;
            switch (part) {
                case "(":
                    store.groups.push("");
                    store.names.push("");
                    break;
                case ")":
                    block = store.groups.pop();
                    name = store.names.pop();
                    /* istanbul ignore else */
                    if (name) {
                        named[name] = block.substr(1);
                    }
                    break;
                default:
                    // is it a real group, not a cluster (?:...), or assertion (?=...), (?!...)
                    isGroup = arr[i - 1] === "(" && !/^\?[:!=]/.test(part);
                    if (isGroup) {
                        index ++;
                        // named capture group check
                        name = R_GROUP.exec(part);
                        if (name && name[1]) {
                            if (!groups[name[1]]) {
                                store.names[store.names.length - 1] = name[1];
                                groups[name[1]] = index;
                            } else {
                                store.count ++;
                            }
                            part = name[2] || "";
                            if (arr[i + 1] === ")" && !name[2]) {
                                part = "[^]+";
                            }
                        } else {
                            // is not a cluster, assertion or named capture group
                            store.count ++;
                        }
                        // named backreference check
                        name = R_NAMED_BACKREF.exec(part);
                        if (name && name[1]) {
                            part = named[name[1]] || "";
                        }
                    }
                    break;
            }
            store.groups = store.groups.map((group) => {
                return (group + part);
            });
            return part;
        }).join("")
          .replace(R_EMPTY_GROUPS, "$1"); // remove any empty groups
        return {source, groups, named};
    }
    NativeRegExp = RegExp;
    NamedRegExp = class NamedRegExp extends NativeRegExp {
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
                return new NativeRegExp(pattern, flags);
            let {source, groups} = generate(pattern);
            const named = Object.keys(groups).length > 0;
            if (dotall && dotAllBroken) {
                // Fix flag "s" in RegExp(...).constructor
                source = source.replace(/([^\\]|^)\./g, "$1[\\s\\S]");
            } else if (!named)
                return new NativeRegExp(pattern, flags);
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

        static transform(source) {
            const namedGroupsFill = function (match, splitS, pattern, flags, splitE) {
                return `${splitS}RegExp("${pattern.replace(/[\\"]/g, "\\$&")}","${flags}")${splitE}`;
            };
            return source.replace(/(^|[=,;({[\s])\/((?:[^/]|\\\/)*?\(\?<(?:[^/]|\\\/)+)\/([dgimsuy]*)([.,;)}\]\s]|$)/gm, namedGroupsFill);
        }
    }
    RegExp = function RegExp(pattern, flags) {
        return new NamedRegExp(pattern, flags);
    }
    RegExp.prototype = NativeRegExp.prototype;
}());
