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

  Portions based on XRegExp are
  Copyright (c) 2007-present Steven Levithan <http://xregexp.com/>

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
        R_UNIRANGE = /(\\x..|\\u....|\\?[\s\S])(?:-(\\x..|\\u....|\\?[\s\S]))?/g,
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

        // converted from XRegExp tool output
        const UNICODE_DATA = {"aliases":{"other":"c","control":"cc","format":"cf","unassigned":"cn","private_use":"co","surrogate":"cs","letter":"l","cased_letter":"lc","lowercase_letter":"ll","modifier_letter":"lm","other_letter":"lo","titlecase_letter":"lt","uppercase_letter":"lu","mark":"m","spacing_mark":"mc","enclosing_mark":"me","nonspacing_mark":"mn","number":"n","decimal_number":"nd","letter_number":"nl","other_number":"no","punctuation":"p","connector_punctuation":"pc","dash_punctuation":"pd","close_punctuation":"pe","final_punctuation":"pf","initial_punctuation":"pi","other_punctuation":"po","open_punctuation":"ps","symbol":"s","currency_symbol":"sc","modifier_symbol":"sk","math_symbol":"sm","other_symbol":"so","separator":"z","line_separator":"zl","paragraph_separator":"zp","space_separator":"zs"},"ranges":{"c":"\u0000-\u001f-­͸͹΀-΃΋΍΢԰՗՘֋֌֐׈-׏׫-׮׵-؅؜۝܎܏݋݌޲-޿߻߼࠮࠯࠿࡜࡝࡟࡫-࡯࢏-ࢗ࣢঄঍঎঑঒঩঱঳-঵঺঻৅৆৉৊৏-৖৘-৛৞৤৥৿਀਄਋-਎਑਒਩਱਴਷਺਻਽੃-੆੉੊੎-੐੒-੘੝੟-੥੷-઀઄઎઒઩઱઴઺઻૆૊૎૏૑-૟૤૥૲-૸଀଄଍଎଑଒଩଱଴଺଻୅୆୉୊୎-୔୘-୛୞୤୥୸-஁஄஋-஍஑஖-஘஛஝஠-஢஥-஧஫-஭஺-஽௃-௅௉௎௏௑-௖௘-௥௻-௿఍఑఩఺఻౅౉౎-౔౗౛౜౞౟౤౥౰-౶಍಑಩಴಺಻೅೉೎-೔೗-೜೟೤೥೰ೳ-೿഍഑൅൉൐-൓൤൥඀඄඗-඙඲඼඾඿෇-෉෋-෎෕෗෠-෥෰෱෵-฀฻-฾๜-຀຃຅຋຤຦຾຿໅໇໎໏໚໛໠-໿཈཭-཰྘྽࿍࿛-࿿჆჈-჌჎჏቉቎቏቗቙቞቟኉኎኏኱኶኷኿዁዆዇዗጑጖጗፛፜፽-፿᎚-᎟᏶᏷᏾᏿᚝-᚟᛹-᛿᜖-᜞᜷-᜿᝔-᝟᝭᝱᝴-᝿៞៟៪-៯៺-៿᠎᠚-᠟᡹-᡿᢫-᢯᣶-᣿᤟᤬-᤯᤼-᤿᥁-᥃᥮᥯᥵-᥿᦬-᦯᧊-᧏᧛-᧝᨜᨝᩟᩽᩾᪊-᪏᪚-᪟᪮᪯᫏-᫿᭍-᭏᭿᯴-᯻᰸-᰺᱊-᱌Ᲊ-᲏᲻᲼᳈-᳏᳻-᳿἖἗἞἟὆὇὎὏὘὚὜὞὾὿᾵῅῔῕῜῰῱῵῿​-‏‪-‮⁠-⁯⁲⁳₏₝-₟⃁-⃏⃱-⃿↌-↏␧-␿⑋-⑟⭴⭵⮖⳴-⳸⴦⴨-⴬⴮⴯⵨-⵮⵱-⵾⶗-⶟⶧⶯⶷⶿⷇⷏⷗⷟⹞-⹿⺚⻴-⻿⿖-⿯⿼-⿿぀゗゘㄀-㄄㄰㆏㇤-㇯㈟꒍-꒏꓇-꓏꘬-꘿꛸-꛿Ɤ-꟏꟒꟔Ꟛ-꟱꠭-꠯꠺-꠿꡸-꡿꣆-꣍꣚-꣟꥔-꥞꥽-꥿꧎꧚-꧝꧿꨷-꨿꩎꩏꩚꩛꫃-꫚꫷-꬀꬇꬈꬏꬐꬗-꬟꬧꬯꭬-꭯꯮꯯꯺-꯿힤-힯퟇-퟊퟼-﩮﩯﫚-﫿﬇-﬒﬘-﬜﬷﬽﬿﭂﭅﯃-﯒﶐﶑﷈-﷎﷐-﷯︚-︟﹓﹧﹬-﹯﹵﻽-＀﾿-￁￈￉￐￑￘￙￝-￟￧￯-￻￾￿","cc":"\u0000-\u001f-","cf":"­؀-؅؜۝܏࢐࢑࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻","cn":"͸͹΀-΃΋΍΢԰՗՘֋֌֐׈-׏׫-׮׵-׿܎݋݌޲-޿߻߼࠮࠯࠿࡜࡝࡟࡫-࡯࢏࢒-ࢗ঄঍঎঑঒঩঱঳-঵঺঻৅৆৉৊৏-৖৘-৛৞৤৥৿਀਄਋-਎਑਒਩਱਴਷਺਻਽੃-੆੉੊੎-੐੒-੘੝੟-੥੷-઀઄઎઒઩઱઴઺઻૆૊૎૏૑-૟૤૥૲-૸଀଄଍଎଑଒଩଱଴଺଻୅୆୉୊୎-୔୘-୛୞୤୥୸-஁஄஋-஍஑஖-஘஛஝஠-஢஥-஧஫-஭஺-஽௃-௅௉௎௏௑-௖௘-௥௻-௿఍఑఩఺఻౅౉౎-౔౗౛౜౞౟౤౥౰-౶಍಑಩಴಺಻೅೉೎-೔೗-೜೟೤೥೰ೳ-೿഍഑൅൉൐-൓൤൥඀඄඗-඙඲඼඾඿෇-෉෋-෎෕෗෠-෥෰෱෵-฀฻-฾๜-຀຃຅຋຤຦຾຿໅໇໎໏໚໛໠-໿཈཭-཰྘྽࿍࿛-࿿჆჈-჌჎჏቉቎቏቗቙቞቟኉኎኏኱኶኷኿዁዆዇዗጑጖጗፛፜፽-፿᎚-᎟᏶᏷᏾᏿᚝-᚟᛹-᛿᜖-᜞᜷-᜿᝔-᝟᝭᝱᝴-᝿៞៟៪-៯៺-៿᠚-᠟᡹-᡿᢫-᢯᣶-᣿᤟᤬-᤯᤼-᤿᥁-᥃᥮᥯᥵-᥿᦬-᦯᧊-᧏᧛-᧝᨜᨝᩟᩽᩾᪊-᪏᪚-᪟᪮᪯᫏-᫿᭍-᭏᭿᯴-᯻᰸-᰺᱊-᱌Ᲊ-᲏᲻᲼᳈-᳏᳻-᳿἖἗἞἟὆὇὎὏὘὚὜὞὾὿᾵῅῔῕῜῰῱῵῿⁥⁲⁳₏₝-₟⃁-⃏⃱-⃿↌-↏␧-␿⑋-⑟⭴⭵⮖⳴-⳸⴦⴨-⴬⴮⴯⵨-⵮⵱-⵾⶗-⶟⶧⶯⶷⶿⷇⷏⷗⷟⹞-⹿⺚⻴-⻿⿖-⿯⿼-⿿぀゗゘㄀-㄄㄰㆏㇤-㇯㈟꒍-꒏꓇-꓏꘬-꘿꛸-꛿Ɤ-꟏꟒꟔Ꟛ-꟱꠭-꠯꠺-꠿꡸-꡿꣆-꣍꣚-꣟꥔-꥞꥽-꥿꧎꧚-꧝꧿꨷-꨿꩎꩏꩚꩛꫃-꫚꫷-꬀꬇꬈꬏꬐꬗-꬟꬧꬯꭬-꭯꯮꯯꯺-꯿힤-힯퟇-퟊퟼-퟿﩮﩯﫚-﫿﬇-﬒﬘-﬜﬷﬽﬿﭂﭅﯃-﯒﶐﶑﷈-﷎﷐-﷯︚-︟﹓﹧﹬-﹯﹵﻽﻾＀﾿-￁￈￉￐￑￘￙￝-￟￧￯-￸￾￿","co":"-","cs":"\ud800-\udfff","l":"A-Za-zªµºÀ-ÖØ-öø-ˁˆ-ˑˠ-ˤˬˮͰ-ʹͶͷͺ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՙՠ-ֈא-תׯ-ײؠ-يٮٯٱ-ۓەۥۦۮۯۺ-ۼۿܐܒ-ܯݍ-ޥޱߊ-ߪߴߵߺࠀ-ࠕࠚࠤࠨࡀ-ࡘࡠ-ࡪࡰ-ࢇࢉ-ࢎࢠ-ࣉऄ-हऽॐक़-ॡॱ-ঀঅ-ঌএঐও-নপ-রলশ-হঽৎড়ঢ়য়-ৡৰৱৼਅ-ਊਏਐਓ-ਨਪ-ਰਲਲ਼ਵਸ਼ਸਹਖ਼-ੜਫ਼ੲ-ੴઅ-ઍએ-ઑઓ-નપ-રલળવ-હઽૐૠૡૹଅ-ଌଏଐଓ-ନପ-ରଲଳଵ-ହଽଡ଼ଢ଼ୟ-ୡୱஃஅ-ஊஎ-ஐஒ-கஙசஜஞடணதந-பம-ஹௐఅ-ఌఎ-ఐఒ-నప-హఽౘ-ౚౝౠౡಀಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹಽೝೞೠೡೱೲഄ-ഌഎ-ഐഒ-ഺഽൎൔ-ൖൟ-ൡൺ-ൿඅ-ඖක-නඳ-රලව-ෆก-ะาำเ-ๆກຂຄຆ-ຊຌ-ຣລວ-ະາຳຽເ-ໄໆໜ-ໟༀཀ-ཇཉ-ཬྈ-ྌက-ဪဿၐ-ၕၚ-ၝၡၥၦၮ-ၰၵ-ႁႎႠ-ჅჇჍა-ჺჼ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚᎀ-ᎏᎠ-Ᏽᏸ-ᏽᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛱ-ᛸᜀ-ᜑᜟ-ᜱᝀ-ᝑᝠ-ᝬᝮ-ᝰក-ឳៗៜᠠ-ᡸᢀ-ᢄᢇ-ᢨᢪᢰ-ᣵᤀ-ᤞᥐ-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉᨀ-ᨖᨠ-ᩔᪧᬅ-ᬳᭅ-ᭌᮃ-ᮠᮮᮯᮺ-ᯥᰀ-ᰣᱍ-ᱏᱚ-ᱽᲀ-ᲈᲐ-ᲺᲽ-Ჿᳩ-ᳬᳮ-ᳳᳵᳶᳺᴀ-ᶿḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼⁱⁿₐ-ₜℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℹℼ-ℿⅅ-ⅉⅎↃↄⰀ-ⳤⳫ-ⳮⳲⳳⴀ-ⴥⴧⴭⴰ-ⵧⵯⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞⸯ々〆〱-〵〻〼ぁ-ゖゝ-ゟァ-ヺー-ヿㄅ-ㄯㄱ-ㆎㆠ-ㆿㇰ-ㇿ㐀-䶿一-ꒌꓐ-ꓽꔀ-ꘌꘐ-ꘟꘪꘫꙀ-ꙮꙿ-ꚝꚠ-ꛥꜗ-ꜟꜢ-ꞈꞋ-ꟊꟐꟑꟓꟕ-ꟙꟲ-ꠁꠃ-ꠅꠇ-ꠊꠌ-ꠢꡀ-ꡳꢂ-ꢳꣲ-ꣷꣻꣽꣾꤊ-ꤥꤰ-ꥆꥠ-ꥼꦄ-ꦲꧏꧠ-ꧤꧦ-ꧯꧺ-ꧾꨀ-ꨨꩀ-ꩂꩄ-ꩋꩠ-ꩶꩺꩾ-ꪯꪱꪵꪶꪹ-ꪽꫀꫂꫛ-ꫝꫠ-ꫪꫲ-ꫴꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꬰ-ꭚꭜ-ꭩꭰ-ꯢ가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎ﬀ-ﬆﬓ-ﬗיִײַ-ﬨשׁ-זּטּ-לּמּנּסּףּפּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼＡ-Ｚａ-ｚｦ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ","lc":"A-Za-zµÀ-ÖØ-öø-ƺƼ-ƿǄ-ʓʕ-ʯͰ-ͳͶͷͻ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՠ-ֈႠ-ჅჇჍა-ჺჽ-ჿᎠ-Ᏽᏸ-ᏽᲀ-ᲈᲐ-ᲺᲽ-Ჿᴀ-ᴫᵫ-ᵷᵹ-ᶚḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℴℹℼ-ℿⅅ-ⅉⅎↃↄⰀ-ⱻⱾ-ⳤⳫ-ⳮⳲⳳⴀ-ⴥⴧⴭꙀ-ꙭꚀ-ꚛꜢ-ꝯꝱ-ꞇꞋ-ꞎꞐ-ꟊꟐꟑꟓꟕ-ꟙꟵꟶꟺꬰ-ꭚꭠ-ꭨꭰ-ꮿﬀ-ﬆﬓ-ﬗＡ-Ｚａ-ｚ","ll":"a-zµß-öø-ÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĳĵķĸĺļľŀłńņňŉŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżž-ƀƃƅƈƌƍƒƕƙ-ƛƞơƣƥƨƪƫƭưƴƶƹƺƽ-ƿǆǉǌǎǐǒǔǖǘǚǜǝǟǡǣǥǧǩǫǭǯǰǳǵǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟȡȣȥȧȩȫȭȯȱȳ-ȹȼȿɀɂɇɉɋɍɏ-ʓʕ-ʯͱͳͷͻ-ͽΐά-ώϐϑϕ-ϗϙϛϝϟϡϣϥϧϩϫϭϯ-ϳϵϸϻϼа-џѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӂӄӆӈӊӌӎӏӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯՠ-ֈა-ჺჽ-ჿᏸ-ᏽᲀ-ᲈᴀ-ᴫᵫ-ᵷᵹ-ᶚḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕ-ẝẟạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿ-ἇἐ-ἕἠ-ἧἰ-ἷὀ-ὅὐ-ὗὠ-ὧὰ-ώᾀ-ᾇᾐ-ᾗᾠ-ᾧᾰ-ᾴᾶᾷιῂ-ῄῆῇῐ-ΐῖῗῠ-ῧῲ-ῴῶῷℊℎℏℓℯℴℹℼℽⅆ-ⅉⅎↄⰰ-ⱟⱡⱥⱦⱨⱪⱬⱱⱳⱴⱶ-ⱻⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳤⳬⳮⳳⴀ-ⴥⴧⴭꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯ-ꜱꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝱ-ꝸꝺꝼꝿꞁꞃꞅꞇꞌꞎꞑꞓ-ꞕꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩꞯꞵꞷꞹꞻꞽꞿꟁꟃꟈꟊꟑꟓꟕꟗꟙꟶꟺꬰ-ꭚꭠ-ꭨꭰ-ꮿﬀ-ﬆﬓ-ﬗａ-ｚ","lm":"ʰ-ˁˆ-ˑˠ-ˤˬˮʹͺՙـۥۦߴߵߺࠚࠤࠨࣉॱๆໆჼៗᡃᪧᱸ-ᱽᴬ-ᵪᵸᶛ-ᶿⁱⁿₐ-ₜⱼⱽⵯⸯ々〱-〵〻ゝゞー-ヾꀕꓸ-ꓽꘌꙿꚜꚝꜗ-ꜟꝰꞈꟲ-ꟴꟸꟹꧏꧦꩰꫝꫳꫴꭜ-ꭟꭩｰﾞﾟ","lo":"ªºƻǀ-ǃʔא-תׯ-ײؠ-ؿف-يٮٯٱ-ۓەۮۯۺ-ۼۿܐܒ-ܯݍ-ޥޱߊ-ߪࠀ-ࠕࡀ-ࡘࡠ-ࡪࡰ-ࢇࢉ-ࢎࢠ-ࣈऄ-हऽॐक़-ॡॲ-ঀঅ-ঌএঐও-নপ-রলশ-হঽৎড়ঢ়য়-ৡৰৱৼਅ-ਊਏਐਓ-ਨਪ-ਰਲਲ਼ਵਸ਼ਸਹਖ਼-ੜਫ਼ੲ-ੴઅ-ઍએ-ઑઓ-નપ-રલળવ-હઽૐૠૡૹଅ-ଌଏଐଓ-ନପ-ରଲଳଵ-ହଽଡ଼ଢ଼ୟ-ୡୱஃஅ-ஊஎ-ஐஒ-கஙசஜஞடணதந-பம-ஹௐఅ-ఌఎ-ఐఒ-నప-హఽౘ-ౚౝౠౡಀಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹಽೝೞೠೡೱೲഄ-ഌഎ-ഐഒ-ഺഽൎൔ-ൖൟ-ൡൺ-ൿඅ-ඖක-නඳ-රලව-ෆก-ะาำเ-ๅກຂຄຆ-ຊຌ-ຣລວ-ະາຳຽເ-ໄໜ-ໟༀཀ-ཇཉ-ཬྈ-ྌက-ဪဿၐ-ၕၚ-ၝၡၥၦၮ-ၰၵ-ႁႎᄀ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚᎀ-ᎏᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛱ-ᛸᜀ-ᜑᜟ-ᜱᝀ-ᝑᝠ-ᝬᝮ-ᝰក-ឳៜᠠ-ᡂᡄ-ᡸᢀ-ᢄᢇ-ᢨᢪᢰ-ᣵᤀ-ᤞᥐ-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉᨀ-ᨖᨠ-ᩔᬅ-ᬳᭅ-ᭌᮃ-ᮠᮮᮯᮺ-ᯥᰀ-ᰣᱍ-ᱏᱚ-ᱷᳩ-ᳬᳮ-ᳳᳵᳶᳺℵ-ℸⴰ-ⵧⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞ〆〼ぁ-ゖゟァ-ヺヿㄅ-ㄯㄱ-ㆎㆠ-ㆿㇰ-ㇿ㐀-䶿一-ꀔꀖ-ꒌꓐ-ꓷꔀ-ꘋꘐ-ꘟꘪꘫꙮꚠ-ꛥꞏꟷꟻ-ꠁꠃ-ꠅꠇ-ꠊꠌ-ꠢꡀ-ꡳꢂ-ꢳꣲ-ꣷꣻꣽꣾꤊ-ꤥꤰ-ꥆꥠ-ꥼꦄ-ꦲꧠ-ꧤꧧ-ꧯꧺ-ꧾꨀ-ꨨꩀ-ꩂꩄ-ꩋꩠ-ꩯꩱ-ꩶꩺꩾ-ꪯꪱꪵꪶꪹ-ꪽꫀꫂꫛꫜꫠ-ꫪꫲꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꯀ-ꯢ가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎יִײַ-ﬨשׁ-זּטּ-לּמּנּסּףּפּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼｦ-ｯｱ-ﾝﾠ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ","lt":"ǅǈǋǲᾈ-ᾏᾘ-ᾟᾨ-ᾯᾼῌῼ","lu":"A-ZÀ-ÖØ-ÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉ-ƋƎ-ƑƓƔƖ-ƘƜƝƟƠƢƤƦƧƩƬƮƯƱ-ƳƵƷƸƼǄǇǊǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǴǶ-ǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃ-ɆɈɊɌɎͰͲͶͿΆΈ-ΊΌΎΏΑ-ΡΣ-ΫϏϒ-ϔϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽ-ЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱ-ՖႠ-ჅჇჍᎠ-ᏵᲐ-ᲺᲽ-ᲿḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈ-ἏἘ-ἝἨ-ἯἸ-ἿὈ-ὍὙὛὝὟὨ-ὯᾸ-ΆῈ-ΉῘ-ΊῨ-ῬῸ-Ώℂℇℋ-ℍℐ-ℒℕℙ-ℝℤΩℨK-ℭℰ-ℳℾℿⅅↃⰀ-ⰯⱠⱢ-ⱤⱧⱩⱫⱭ-ⱰⱲⱵⱾ-ⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪ-ꞮꞰ-ꞴꞶꞸꞺꞼꞾꟀꟂꟄ-ꟇꟉꟐꟖꟘꟵＡ-Ｚ","m":"̀-ͯ҃-҉֑-ׇֽֿׁׂׅׄؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ܑۭܰ-݊ަ-ް߫-߽߳ࠖ-࠙ࠛ-ࠣࠥ-ࠧࠩ-࡙࠭-࡛࢘-࢟࣊-ࣣ࣡-ःऺ-़ा-ॏ॑-ॗॢॣঁ-ঃ়া-ৄেৈো-্ৗৢৣ৾ਁ-ਃ਼ਾ-ੂੇੈੋ-੍ੑੰੱੵઁ-ઃ઼ા-ૅે-ૉો-્ૢૣૺ-૿ଁ-ଃ଼ା-ୄେୈୋ-୍୕-ୗୢୣஂா-ூெ-ைொ-்ௗఀ-ఄ఼ా-ౄె-ైొ-్ౕౖౢౣಁ-ಃ಼ಾ-ೄೆ-ೈೊ-್ೕೖೢೣഀ-ഃ഻഼ാ-ൄെ-ൈൊ-്ൗൢൣඁ-ඃ්ා-ුූෘ-ෟෲෳัิ-ฺ็-๎ັິ-ຼ່-ໍ༹༘༙༵༷༾༿ཱ-྄྆྇ྍ-ྗྙ-ྼ࿆ါ-ှၖ-ၙၞ-ၠၢ-ၤၧ-ၭၱ-ၴႂ-ႍႏႚ-ႝ፝-፟ᜒ-᜕ᜲ-᜴ᝒᝓᝲᝳ឴-៓៝᠋-᠍᠏ᢅᢆᢩᤠ-ᤫᤰ-᤻ᨗ-ᨛᩕ-ᩞ᩠-᩿᩼᪰-ᫎᬀ-ᬄ᬴-᭄᭫-᭳ᮀ-ᮂᮡ-ᮭ᯦-᯳ᰤ-᰷᳐-᳔᳒-᳨᳭᳴᳷-᳹᷀-᷿⃐-⃰⳯-⵿⳱ⷠ-〪ⷿ-゙゚〯꙯-꙲ꙴ-꙽ꚞꚟ꛰꛱ꠂ꠆ꠋꠣ-ꠧ꠬ꢀꢁꢴ-ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-꥓ꦀ-ꦃ꦳-꧀ꧥꨩ-ꨶꩃꩌꩍꩻ-ꩽꪰꪲ-ꪴꪷꪸꪾ꪿꫁ꫫ-ꫯꫵ꫶ꯣ-ꯪ꯬꯭ﬞ︀-️︠-︯","mc":"ःऻा-ीॉ-ौॎॏংঃা-ীেৈোৌৗਃਾ-ੀઃા-ીૉોૌଂଃାୀେୈୋୌୗாிுூெ-ைொ-ௌௗఁ-ఃు-ౄಂಃಾೀ-ೄೇೈೊೋೕೖംഃാ-ീെ-ൈൊ-ൌൗංඃා-ෑෘ-ෟෲෳ༾༿ཿါာေးျြၖၗၢ-ၤၧ-ၭႃႄႇ-ႌႏႚ-ႜ᜕᜴ាើ-ៅះៈᤣ-ᤦᤩ-ᤫᤰᤱᤳ-ᤸᨙᨚᩕᩗᩡᩣᩤᩭ-ᩲᬄᬵᬻᬽ-ᭁᭃ᭄ᮂᮡᮦᮧ᮪ᯧᯪ-ᯬᯮ᯲᯳ᰤ-ᰫᰴᰵ᳡᳷〮〯ꠣꠤꠧꢀꢁꢴ-ꣃꥒ꥓ꦃꦴꦵꦺꦻꦾ-꧀ꨯꨰꨳꨴꩍꩻꩽꫫꫮꫯꫵꯣꯤꯦꯧꯩꯪ꯬","me":"҈҉᪾⃝-⃠⃢-⃤꙰-꙲","mn":"̀-ͯ҃-֑҇-ׇֽֿׁׂׅׄؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ܑۭܰ-݊ަ-ް߫-߽߳ࠖ-࠙ࠛ-ࠣࠥ-ࠧࠩ-࡙࠭-࡛࢘-࢟࣊-ࣣ࣡-ंऺ़ु-ै्॑-ॗॢॣঁ়ু-ৄ্ৢৣ৾ਁਂ਼ੁੂੇੈੋ-੍ੑੰੱੵઁં઼ુ-ૅેૈ્ૢૣૺ-૿ଁ଼ିୁ-ୄ୍୕ୖୢୣஂீ்ఀఄ఼ా-ీె-ైొ-్ౕౖౢౣಁ಼ಿೆೌ್ೢೣഀഁ഻഼ു-ൄ്ൢൣඁ්ි-ුූัิ-ฺ็-๎ັິ-ຼ່-ໍཱ༹༘༙༵༷-ཾྀ-྄྆྇ྍ-ྗྙ-ྼ࿆ိ-ူဲ-့္်ွှၘၙၞ-ၠၱ-ၴႂႅႆႍႝ፝-፟ᜒ-᜔ᜲᜳᝒᝓᝲᝳ឴឵ិ-ួំ៉-៓៝᠋-᠍᠏ᢅᢆᢩᤠ-ᤢᤧᤨᤲ᤹-᤻ᨘᨗᨛᩖᩘ-ᩞ᩠ᩢᩥ-ᩬᩳ-᩿᩼᪰-᪽ᪿ-ᫎᬀ-ᬃ᬴ᬶ-ᬺᬼᭂ᭫-᭳ᮀᮁᮢ-ᮥᮨᮩ᮫-ᮭ᯦ᯨᯩᯭᯯ-ᯱᰬ-ᰳᰶ᰷᳐-᳔᳒-᳢᳠-᳨᳭᳴᳸᳹᷀-᷿⃐-⃥⃜⃡-⃰⳯-⵿⳱ⷠ-〪ⷿ-゙゚〭꙯ꙴ-꙽ꚞꚟ꛰꛱ꠂ꠆ꠋꠥꠦ꠬꣄ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-ꥑꦀ-ꦂ꦳ꦶ-ꦹꦼꦽꧥꨩ-ꨮꨱꨲꨵꨶꩃꩌꩼꪰꪲ-ꪴꪷꪸꪾ꪿꫁ꫬꫭ꫶ꯥꯨ꯭ﬞ︀-️︠-︯","n":"0-9²³¹¼-¾٠-٩۰-۹߀-߉०-९০-৯৴-৹੦-੯૦-૯୦-୯୲-୷௦-௲౦-౯౸-౾೦-೯൘-൞൦-൸෦-෯๐-๙໐-໙༠-༳၀-၉႐-႙፩-፼ᛮ-ᛰ០-៩៰-៹᠐-᠙᥆-᥏᧐-᧚᪀-᪉᪐-᪙᭐-᭙᮰-᮹᱀-᱉᱐-᱙⁰⁴-⁹₀-₉⅐-ↂↅ-↉①-⒛⓪-⓿❶-➓⳽〇〡-〩〸-〺㆒-㆕㈠-㈩㉈-㉏㉑-㉟㊀-㊉㊱-㊿꘠-꘩ꛦ-ꛯ꠰-꠵꣐-꣙꤀-꤉꧐-꧙꧰-꧹꩐-꩙꯰-꯹０-９","nd":"0-9٠-٩۰-۹߀-߉०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯෦-෯๐-๙໐-໙༠-༩၀-၉႐-႙០-៩᠐-᠙᥆-᥏᧐-᧙᪀-᪉᪐-᪙᭐-᭙᮰-᮹᱀-᱉᱐-᱙꘠-꘩꣐-꣙꤀-꤉꧐-꧙꧰-꧹꩐-꩙꯰-꯹０-９","nl":"ᛮ-ᛰⅠ-ↂↅ-ↈ〇〡-〩〸-〺ꛦ-ꛯ","no":"²³¹¼-¾৴-৹୲-୷௰-௲౸-౾൘-൞൰-൸༪-༳፩-፼៰-៹᧚⁰⁴-⁹₀-₉⅐-⅟↉①-⒛⓪-⓿❶-➓⳽㆒-㆕㈠-㈩㉈-㉏㉑-㉟㊀-㊉㊱-㊿꠰-꠵","p":"!-#%-\\*,-\\/:;\\?@\\[-\\]_\\{\\}¡§«¶·»¿;·՚-՟։֊־׀׃׆׳״؉؊،؍؛؝-؟٪-٭۔܀-܍߷-߹࠰-࠾࡞।॥॰৽੶૰౷಄෴๏๚๛༄-༒༔༺-༽྅࿐-࿔࿙࿚၊-၏჻፠-፨᐀᙮᚛᚜᛫-᛭᜵᜶។-៖៘-៚᠀-᠊᥄᥅᨞᨟᪠-᪦᪨-᪭᭚-᭠᭽᭾᯼-᯿᰻-᰿᱾᱿᳀-᳇᳓‐-‧‰-⁃⁅-⁑⁓-⁞⁽⁾₍₎⌈-⌋〈〉❨-❵⟅⟆⟦-⟯⦃-⦘⧘-⧛⧼⧽⳹-⳼⳾⳿⵰⸀-⸮⸰-⹏⹒-⹝、-〃〈-】〔-〟〰〽゠・꓾꓿꘍-꘏꙳꙾꛲-꛷꡴-꡷꣎꣏꣸-꣺꣼꤮꤯꥟꧁-꧍꧞꧟꩜-꩟꫞꫟꫰꫱꯫﴾﴿︐-︙︰-﹒﹔-﹡﹣﹨﹪﹫！-＃％-＊，-／：；？＠［-］＿｛｝｟-･","pc":"_‿⁀⁔︳︴﹍-﹏＿","pd":"\\-֊־᐀᠆‐-―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－","pe":"\\)\\]\\}༻༽᚜⁆⁾₎⌉⌋〉❩❫❭❯❱❳❵⟆⟧⟩⟫⟭⟯⦄⦆⦈⦊⦌⦎⦐⦒⦔⦖⦘⧙⧛⧽⸣⸥⸧⸩⹖⹘⹚⹜〉》」』】〕〗〙〛〞〟﴾︘︶︸︺︼︾﹀﹂﹄﹈﹚﹜﹞）］｝｠｣","pf":"»’”›⸃⸅⸊⸍⸝⸡","pi":"«‘‛“‟‹⸂⸄⸉⸌⸜⸠","po":"!-#%-'\\*,\\.\\/:;\\?@\\¡§¶·¿;·՚-՟։׀׃׆׳״؉؊،؍؛؝-؟٪-٭۔܀-܍߷-߹࠰-࠾࡞।॥॰৽੶૰౷಄෴๏๚๛༄-༒༔྅࿐-࿔࿙࿚၊-၏჻፠-፨᙮᛫-᛭᜵᜶។-៖៘-៚᠀-᠅᠇-᠊᥄᥅᨞᨟᪠-᪦᪨-᪭᭚-᭠᭽᭾᯼-᯿᰻-᰿᱾᱿᳀-᳇᳓‖‗†-‧‰-‸※-‾⁁-⁃⁇-⁑⁓⁕-⁞⳹-⳼⳾⳿⵰⸀⸁⸆-⸈⸋⸎-⸖⸘⸙⸛⸞⸟⸪-⸮⸰-⸹⸼-⸿⹁⹃-⹏⹒-⹔、-〃〽・꓾꓿꘍-꘏꙳꙾꛲-꛷꡴-꡷꣎꣏꣸-꣺꣼꤮꤯꥟꧁-꧍꧞꧟꩜-꩟꫞꫟꫰꫱꯫︐-︖︙︰﹅﹆﹉-﹌﹐-﹒﹔-﹗﹟-﹡﹨﹪﹫！-＃％-＇＊，．／：；？＠＼｡､･","ps":"\\(\\[\\{༺༼᚛‚„⁅⁽₍⌈⌊〈❨❪❬❮❰❲❴⟅⟦⟨⟪⟬⟮⦃⦅⦇⦉⦋⦍⦏⦑⦓⦕⦗⧘⧚⧼⸢⸤⸦⸨⹂⹕⹗⹙⹛〈《「『【〔〖〘〚〝﴿︗︵︷︹︻︽︿﹁﹃﹇﹙﹛﹝（［｛｟｢","s":"\\$\\+<->\\^`\\|~¢-¦¨©¬®-±´¸×÷˂-˅˒-˟˥-˫˭˯-˿͵΄΅϶҂֍-֏؆-؈؋؎؏۞۩۽۾߶߾߿࢈৲৳৺৻૱୰௳-௺౿൏൹฿༁-༃༓༕-༗༚-༟༴༶༸྾-࿅࿇-࿌࿎࿏࿕-࿘႞႟᎐-᎙᙭៛᥀᧞-᧿᭡-᭪᭴-᭼᾽᾿-῁῍-῏῝-῟῭-`´῾⁄⁒⁺-⁼₊-₌₠-⃀℀℁℃-℆℈℉℔№-℘℞-℣℥℧℩℮℺℻⅀-⅄⅊-⅍⅏↊↋←-⌇⌌-⌨⌫-␦⑀-⑊⒜-ⓩ─-❧➔-⟄⟇-⟥⟰-⦂⦙-⧗⧜-⧻⧾-⭳⭶-⮕⮗-⯿⳥-⳪⹐⹑⺀-⺙⺛-⻳⼀-⿕⿰-⿻〄〒〓〠〶〷〾〿゛゜㆐㆑㆖-㆟㇀-㇣㈀-㈞㈪-㉇㉐㉠-㉿㊊-㊰㋀-㏿䷀-䷿꒐-꓆꜀-꜖꜠꜡꞉꞊꠨-꠫꠶-꠹꩷-꩹꭛꭪꭫﬩﮲-﯂﵀-﵏﷏﷼-﷿﹢﹤-﹦﹩＄＋＜-＞＾｀｜～￠-￦￨-￮￼�","sc":"\\$¢-¥֏؋߾߿৲৳৻૱௹฿៛₠-⃀꠸﷼﹩＄￠￡￥￦","sk":"\\^`¨¯´¸˂-˅˒-˟˥-˫˭˯-˿͵΄΅࢈᾽᾿-῁῍-῏῝-῟῭-`´῾゛゜꜀-꜖꜠꜡꞉꞊꭛꭪꭫﮲-﯂＾｀￣","sm":"\\+<->\\|~¬±×÷϶؆-؈⁄⁒⁺-⁼₊-₌℘⅀-⅄⅋←-↔↚↛↠↣↦↮⇎⇏⇒⇔⇴-⋿⌠⌡⍼⎛-⎳⏜-⏡▷◁◸-◿♯⟀-⟄⟇-⟥⟰-⟿⤀-⦂⦙-⧗⧜-⧻⧾-⫿⬰-⭄⭇-⭌﬩﹢﹤-﹦＋＜-＞｜～￢￩-￬","so":"¦©®°҂֍֎؎؏۞۩۽۾߶৺୰௳-௸௺౿൏൹༁-༃༓༕-༗༚-༟༴༶༸྾-࿅࿇-࿌࿎࿏࿕-࿘႞႟᎐-᎙᙭᥀᧞-᧿᭡-᭪᭴-᭼℀℁℃-℆℈℉℔№℗℞-℣℥℧℩℮℺℻⅊⅌⅍⅏↊↋↕-↙↜-↟↡↢↤↥↧-↭↯-⇍⇐⇑⇓⇕-⇳⌀-⌇⌌-⌟⌢-⌨⌫-⍻⍽-⎚⎴-⏛⏢-␦⑀-⑊⒜-ⓩ─-▶▸-◀◂-◷☀-♮♰-❧➔-➿⠀-⣿⬀-⬯⭅⭆⭍-⭳⭶-⮕⮗-⯿⳥-⳪⹐⹑⺀-⺙⺛-⻳⼀-⿕⿰-⿻〄〒〓〠〶〷〾〿㆐㆑㆖-㆟㇀-㇣㈀-㈞㈪-㉇㉐㉠-㉿㊊-㊰㋀-㏿䷀-䷿꒐-꓆꠨-꠫꠶꠷꠹꩷-꩹﵀-﵏﷏﷽-﷿￤￨￭￮￼�","z":"    -     　","zl":" ","zp":" ","zs":"    -   　","ascii":"\u0000-","alphabetic":"A-Za-zªµºÀ-ÖØ-öø-ˁˆ-ˑˠ-ˤˬˮͅͰ-ʹͶͷͺ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՙՠ-ֈְ-ׇֽֿׁׂׅׄא-תׯ-ײؐ-ؚؠ-ٗٙ-ٟٮ-ۓە-ۜۡ-ۭۨ-ۯۺ-ۼۿܐ-ܿݍ-ޱߊ-ߪߴߵߺࠀ-ࠗࠚ-ࠬࡀ-ࡘࡠ-ࡪࡰ-ࢇࢉ-ࢎࢠ-ࣉࣔ-ࣣࣟ-ࣰࣩ-ऻऽ-ौॎ-ॐॕ-ॣॱ-ঃঅ-ঌএঐও-নপ-রলশ-হঽ-ৄেৈোৌৎৗড়ঢ়য়-ৣৰৱৼਁ-ਃਅ-ਊਏਐਓ-ਨਪ-ਰਲਲ਼ਵਸ਼ਸਹਾ-ੂੇੈੋੌੑਖ਼-ੜਫ਼ੰ-ੵઁ-ઃઅ-ઍએ-ઑઓ-નપ-રલળવ-હઽ-ૅે-ૉોૌૐૠ-ૣૹ-ૼଁ-ଃଅ-ଌଏଐଓ-ନପ-ରଲଳଵ-ହଽ-ୄେୈୋୌୖୗଡ଼ଢ଼ୟ-ୣୱஂஃஅ-ஊஎ-ஐஒ-கஙசஜஞடணதந-பம-ஹா-ூெ-ைொ-ௌௐௗఀ-ఃఅ-ఌఎ-ఐఒ-నప-హఽ-ౄె-ైొ-ౌౕౖౘ-ౚౝౠ-ౣಀ-ಃಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹಽ-ೄೆ-ೈೊ-ೌೕೖೝೞೠ-ೣೱೲഀ-ഌഎ-ഐഒ-ഺഽ-ൄെ-ൈൊ-ൌൎൔ-ൗൟ-ൣൺ-ൿඁ-ඃඅ-ඖක-නඳ-රලව-ෆා-ුූෘ-ෟෲෳก-ฺเ-ๆํກຂຄຆ-ຊຌ-ຣລວ-ູົ-ຽເ-ໄໆໍໜ-ໟༀཀ-ཇཉ-ཬཱ-ཱྀྈ-ྗྙ-ྼက-ံးျ-ဿၐ-ႏႚ-ႝႠ-ჅჇჍა-ჺჼ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚᎀ-ᎏᎠ-Ᏽᏸ-ᏽᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛮ-ᛸᜀ-ᜓᜟ-ᜳᝀ-ᝓᝠ-ᝬᝮ-ᝰᝲᝳក-ឳា-ៈៗៜᠠ-ᡸᢀ-ᢪᢰ-ᣵᤀ-ᤞᤠ-ᤫᤰ-ᤸᥐ-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉᨀ-ᨛᨠ-ᩞᩡ-ᩴᪧᪿᫀᫌ-ᫎᬀ-ᬳᬵ-ᭃᭅ-ᭌᮀ-ᮩᮬ-ᮯᮺ-ᯥᯧ-ᯱᰀ-ᰶᱍ-ᱏᱚ-ᱽᲀ-ᲈᲐ-ᲺᲽ-Ჿᳩ-ᳬᳮ-ᳳᳵᳶᳺᴀ-ᶿᷧ-ᷴḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼⁱⁿₐ-ₜℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℹℼ-ℿⅅ-ⅉⅎⅠ-ↈⒶ-ⓩⰀ-ⳤⳫ-ⳮⳲⳳⴀ-ⴥⴧⴭⴰ-ⵧⵯⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞⷠ-ⷿⸯ々-〇〡-〩〱-〵〸-〼ぁ-ゖゝ-ゟァ-ヺー-ヿㄅ-ㄯㄱ-ㆎㆠ-ㆿㇰ-ㇿ㐀-䶿一-ꒌꓐ-ꓽꔀ-ꘌꘐ-ꘟꘪꘫꙀ-ꙮꙴ-ꙻꙿ-ꛯꜗ-ꜟꜢ-ꞈꞋ-ꟊꟐꟑꟓꟕ-ꟙꟲ-ꠅꠇ-ꠧꡀ-ꡳꢀ-ꣃꣅꣲ-ꣷꣻꣽ-ꣿꤊ-ꤪꤰ-ꥒꥠ-ꥼꦀ-ꦲꦴ-ꦿꧏꧠ-ꧯꧺ-ꧾꨀ-ꨶꩀ-ꩍꩠ-ꩶꩺ-ꪾꫀꫂꫛ-ꫝꫠ-ꫯꫲ-ꫵꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꬰ-ꭚꭜ-ꭩꭰ-ꯪ가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎ﬀ-ﬆﬓ-ﬗיִ-ﬨשׁ-זּטּ-לּמּנּסּףּפּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼＡ-Ｚａ-ｚｦ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ","any":"\u0000-￿","default_ignorable_code_point":"­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￸","lowercase":"a-zªµºß-öø-ÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĳĵķĸĺļľŀłńņňŉŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżž-ƀƃƅƈƌƍƒƕƙ-ƛƞơƣƥƨƪƫƭưƴƶƹƺƽ-ƿǆǉǌǎǐǒǔǖǘǚǜǝǟǡǣǥǧǩǫǭǯǰǳǵǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟȡȣȥȧȩȫȭȯȱȳ-ȹȼȿɀɂɇɉɋɍɏ-ʓʕ-ʸˀˁˠ-ˤͅͱͳͷͺ-ͽΐά-ώϐϑϕ-ϗϙϛϝϟϡϣϥϧϩϫϭϯ-ϳϵϸϻϼа-џѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӂӄӆӈӊӌӎӏӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯՠ-ֈა-ჺჽ-ჿᏸ-ᏽᲀ-ᲈᴀ-ᶿḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕ-ẝẟạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿ-ἇἐ-ἕἠ-ἧἰ-ἷὀ-ὅὐ-ὗὠ-ὧὰ-ώᾀ-ᾇᾐ-ᾗᾠ-ᾧᾰ-ᾴᾶᾷιῂ-ῄῆῇῐ-ΐῖῗῠ-ῧῲ-ῴῶῷⁱⁿₐ-ₜℊℎℏℓℯℴℹℼℽⅆ-ⅉⅎⅰ-ⅿↄⓐ-ⓩⰰ-ⱟⱡⱥⱦⱨⱪⱬⱱⱳⱴⱶ-ⱽⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳤⳬⳮⳳⴀ-ⴥⴧⴭꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛ-ꚝꜣꜥꜧꜩꜫꜭꜯ-ꜱꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯ-ꝸꝺꝼꝿꞁꞃꞅꞇꞌꞎꞑꞓ-ꞕꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩꞯꞵꞷꞹꞻꞽꞿꟁꟃꟈꟊꟑꟓꟕꟗꟙꟶꟸ-ꟺꬰ-ꭚꭜ-ꭨꭰ-ꮿﬀ-ﬆﬓ-ﬗａ-ｚ","noncharacter_code_point":"﷐-﷯￾￿","uppercase":"A-ZÀ-ÖØ-ÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉ-ƋƎ-ƑƓƔƖ-ƘƜƝƟƠƢƤƦƧƩƬƮƯƱ-ƳƵƷƸƼǄǇǊǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǴǶ-ǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃ-ɆɈɊɌɎͰͲͶͿΆΈ-ΊΌΎΏΑ-ΡΣ-ΫϏϒ-ϔϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽ-ЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱ-ՖႠ-ჅჇჍᎠ-ᏵᲐ-ᲺᲽ-ᲿḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈ-ἏἘ-ἝἨ-ἯἸ-ἿὈ-ὍὙὛὝὟὨ-ὯᾸ-ΆῈ-ΉῘ-ΊῨ-ῬῸ-Ώℂℇℋ-ℍℐ-ℒℕℙ-ℝℤΩℨK-ℭℰ-ℳℾℿⅅⅠ-ⅯↃⒶ-ⓏⰀ-ⰯⱠⱢ-ⱤⱧⱩⱫⱭ-ⱰⱲⱵⱾ-ⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪ-ꞮꞰ-ꞴꞶꞸꞺꞼꞾꟀꟂꟄ-ꟇꟉꟐꟖꟘꟵＡ-Ｚ","white_space":"\t-\r   -     　","arabic":"؀-؄؆-؋؍-ؚ؜-؞ؠ-ؿف-يٖ-ٯٱ-ۜ۞-ۿݐ-ݿࡰ-ࢎ࢐࢑࢘-ࣣ࣡-ࣿﭐ-﯂ﯓ-ﴽ﵀-ﶏﶒ-ﷇ﷏ﷰ-﷿ﹰ-ﹴﹶ-ﻼ","armenian":"Ա-Ֆՙ-֊֍-֏ﬓ-ﬗ","balinese":"ᬀ-ᭌ᭐-᭾","bamum":"ꚠ-꛷","batak":"ᯀ-᯳᯼-᯿","bengali":"ঀ-ঃঅ-ঌএঐও-নপ-রলশ-হ়-ৄেৈো-ৎৗড়ঢ়য়-ৣ০-৾","bopomofo":"˪˫ㄅ-ㄯㆠ-ㆿ","braille":"⠀-⣿","buginese":"ᨀ-ᨛ᨞᨟","buhid":"ᝀ-ᝓ","canadian_aboriginal":"᐀-ᙿᢰ-ᣵ","cham":"ꨀ-ꨶꩀ-ꩍ꩐-꩙꩜-꩟","cherokee":"Ꭰ-Ᏽᏸ-ᏽꭰ-ꮿ","common":"\u0000-@\\[-`\\{-©«-¹»-¿×÷ʹ-˟˥-˩ˬ-˿ʹ;΅·؅،؛؟ـ۝࣢।॥฿࿕-࿘჻᛫-᛭᜵᜶᠂᠃᠅᳓᳡ᳩ-ᳬᳮ-ᳳᳵ-᳷ᳺ -​‎-⁤⁦-⁰⁴-⁾₀-₎₠-⃀℀-℥℧-℩ℬ-ℱℳ-⅍⅏-⅟↉-↋←-␦⑀-⑊①-⟿⤀-⭳⭶-⮕⮗-⯿⸀-⹝⿰-⿻　-〄〆〈-〠〰-〷〼-〿゛゜゠・ー㆐-㆟㇀-㇣㈠-㉟㉿-㋏㋿㍘-㏿䷀-䷿꜀-꜡ꞈ-꞊꠰-꠹꤮ꧏ꭛꭪꭫﴾﴿︐-︙︰-﹒﹔-﹦﹨-﹫﻿！-＠［-｀｛-･ｰﾞﾟ￠-￦￨-￮￹-�","coptic":"Ϣ-ϯⲀ-ⳳ⳹-⳿","cyrillic":"Ѐ-҄҇-ԯᲀ-ᲈᴫᵸⷠ-ⷿꙀ-ꚟ︮︯","devanagari":"ऀ-ॐॕ-ॣ०-ॿ꣠-ꣿ","ethiopic":"ሀ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚ፝-፼ᎀ-᎙ⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮ","georgian":"Ⴀ-ჅჇჍა-ჺჼ-ჿᲐ-ᲺᲽ-Ჿⴀ-ⴥⴧⴭ","glagolitic":"Ⰰ-ⱟ","greek":"Ͱ-ͳ͵-ͷͺ-ͽͿ΄ΆΈ-ΊΌΎ-ΡΣ-ϡϰ-Ͽᴦ-ᴪᵝ-ᵡᵦ-ᵪᶿἀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ῄῆ-ΐῖ-Ί῝-`ῲ-ῴῶ-῾Ωꭥ","gujarati":"ઁ-ઃઅ-ઍએ-ઑઓ-નપ-રલળવ-હ઼-ૅે-ૉો-્ૐૠ-ૣ૦-૱ૹ-૿","gurmukhi":"ਁ-ਃਅ-ਊਏਐਓ-ਨਪ-ਰਲਲ਼ਵਸ਼ਸਹ਼ਾ-ੂੇੈੋ-੍ੑਖ਼-ੜਫ਼੦-੶","han":"⺀-⺙⺛-⻳⼀-⿕々〇〡-〩〸-〻㐀-䶿一-鿿豈-舘並-龎","hangul":"ᄀ-ᇿ〮〯ㄱ-ㆎ㈀-㈞㉠-㉾ꥠ-ꥼ가-힣ힰ-ퟆퟋ-ퟻﾠ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ","hanunoo":"ᜠ-᜴","hebrew":"֑-ׇא-תׯ-״יִ-זּטּ-לּמּנּסּףּפּצּ-ﭏ","hiragana":"ぁ-ゖゝ-ゟ","inherited":"̀-ًͯ҅҆-ٰٕ॑-॔᪰-ᫎ᳐-᳔᳒-᳢᳠-᳨᳭᳴᳸᳹᷀-᷿‌‍⃐-〪⃰-゙゚〭︀-️︠-︭","javanese":"ꦀ-꧍꧐-꧙꧞꧟","kannada":"ಀ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹ಼-ೄೆ-ೈೊ-್ೕೖೝೞೠ-ೣ೦-೯ೱೲ","katakana":"ァ-ヺヽ-ヿㇰ-ㇿ㋐-㋾㌀-㍗ｦ-ｯｱ-ﾝ","kayah_li":"꤀-꤭꤯","khmer":"ក-៝០-៩៰-៹᧠-᧿","lao":"ກຂຄຆ-ຊຌ-ຣລວ-ຽເ-ໄໆ່-ໍ໐-໙ໜ-ໟ","latin":"A-Za-zªºÀ-ÖØ-öø-ʸˠ-ˤᴀ-ᴥᴬ-ᵜᵢ-ᵥᵫ-ᵷᵹ-ᶾḀ-ỿⁱⁿₐ-ₜKÅℲⅎⅠ-ↈⱠ-ⱿꜢ-ꞇꞋ-ꟊꟐꟑꟓꟕ-ꟙꟲ-ꟿꬰ-ꭚꭜ-ꭤꭦ-ꭩﬀ-ﬆＡ-Ｚａ-ｚ","lepcha":"ᰀ-᰷᰻-᱉ᱍ-ᱏ","limbu":"ᤀ-ᤞᤠ-ᤫᤰ-᤻᥀᥄-᥏","lisu":"ꓐ-꓿","malayalam":"ഀ-ഌഎ-ഐഒ-ൄെ-ൈൊ-൏ൔ-ൣ൦-ൿ","mandaic":"ࡀ-࡛࡞","meetei_mayek":"ꫠ-꫶ꯀ-꯭꯰-꯹","mongolian":"᠀᠁᠄᠆-᠙ᠠ-ᡸᢀ-ᢪ","myanmar":"က-႟ꧠ-ꧾꩠ-ꩿ","new_tai_lue":"ᦀ-ᦫᦰ-ᧉ᧐-᧚᧞᧟","nko":"߀-ߺ߽-߿","ogham":" -᚜","ol_chiki":"᱐-᱿","oriya":"ଁ-ଃଅ-ଌଏଐଓ-ନପ-ରଲଳଵ-ହ଼-ୄେୈୋ-୍୕-ୗଡ଼ଢ଼ୟ-ୣ୦-୷","phags_pa":"ꡀ-꡷","rejang":"ꤰ-꥓꥟","runic":"ᚠ-ᛪᛮ-ᛸ","samaritan":"ࠀ-࠭࠰-࠾","saurashtra":"ꢀ-ꣅ꣎-꣙","sinhala":"ඁ-ඃඅ-ඖක-නඳ-රලව-ෆ්ා-ුූෘ-ෟ෦-෯ෲ-෴","sundanese":"ᮀ-ᮿ᳀-᳇","syloti_nagri":"ꠀ-꠬","syriac":"܀-܍܏-݊ݍ-ݏࡠ-ࡪ","tagalog":"ᜀ-᜕ᜟ","tagbanwa":"ᝠ-ᝬᝮ-ᝰᝲᝳ","tai_le":"ᥐ-ᥭᥰ-ᥴ","tai_tham":"ᨠ-ᩞ᩠-᩿᩼-᪉᪐-᪙᪠-᪭","tai_viet":"ꪀ-ꫂꫛ-꫟","tamil":"ஂஃஅ-ஊஎ-ஐஒ-கஙசஜஞடணதந-பம-ஹா-ூெ-ைொ-்ௐௗ௦-௺","telugu":"ఀ-ఌఎ-ఐఒ-నప-హ఼-ౄె-ైొ-్ౕౖౘ-ౚౝౠ-ౣ౦-౯౷-౿","thaana":"ހ-ޱ","thai":"ก-ฺเ-๛","tibetan":"ༀ-ཇཉ-ཬཱ-ྗྙ-ྼ྾-࿌࿎-࿔࿙࿚","tifinagh":"ⴰ-ⵧⵯ⵰⵿","vai":"ꔀ-ꘫ","yi":"ꀀ-ꒌ꒐-꓆"}};

        // Gets the decimal code of a literal code unit, \xHH, \uHHHH, or a backslash-escaped literal
        function charCode(chr) {
            const esc = /^\\[xu](.+)/.exec(chr);
            return esc ?
                parseInt(esc[1], 16) :
                chr.charCodeAt(chr[0] === '\\' ? 1 : 0);
        }

        function uhex(val) {
            // for the BMP, just encode the character itself
            if (val<0xffff)
                return String.fromCharCode(val);
            return "\\u" + val.toString(16).padStart(4, "0");
        }

        function unicodeInvertRange(range) {
            let output = '';
            let lastEnd = -1;

            for (const m of range.matchAll(R_UNIRANGE)) {
                const start = charCode(m[1]);
                if (start > (lastEnd + 1)) {
                    output += uhex(lastEnd + 1);
                    if (start > (lastEnd + 2)) {
                        output += "-" + uhex(start - 1);
                    }
                }
                lastEnd = charCode(m[2] || m[1]);
            }

            if (lastEnd < 0xFFFF) {
                output += uhex(lastEnd + 1);
                if (lastEnd < 0xFFFE) {
                    output += '-\\uFFFF';
                }
            }

            return output;
        }

        function unicodeGetInverted(rname) {
            let irange, range;
            const iname = rname.toUpperCase();
            if (irange = UNICODE_DATA.ranges[iname])
                return irange;
            if (range = UNICODE_DATA.ranges[rname]) {
                return UNICODE_DATA.ranges[iname] = unicodeInvertRange(range);
            }
            return null;
        }

        function unicodeTranslateEscape(name, inverted, inCC) {
            // Unicode sequence properties may need different translation, but there is no solid standard yet.
            // The most common usage would be \p{Emoji}, which was used before but is extremely unstable, so not used in the wild anymore.
            let range;
            const rname = UNICODE_DATA.aliases[name.toLowerCase()] || name.toLowerCase();
            if (inCC) {
                // must expand inversion
                if (range = (inverted ? unicodeGetInverted(rname) : UNICODE_DATA.ranges[rname]))
                    return range;
            } else {
                // let RegExp do the inverting
                if (range = UNICODE_DATA.ranges[rname])
                    return (inverted?"[^":"[") + range + "]";
            }
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
                        const rep = unicodeTranslateEscape(match[3] || match[2], match[1] == "P", inCC);
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
