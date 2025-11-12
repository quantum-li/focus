const vscode = require('vscode');


const CONF_OPACITY = "focus.opacity";
const CONF_HIGHLIGHT_RANGE = "focus.highlightRange";
const CONF_HIGHLIGHT_RANGE_BLOCK = "block";
const CONF_HIGHLIGHT_RANGE_FIXED = "fixed";
const CONF_HIGHLIGHT_RANGE_NONE = "none";
const CONF_HIGHLIGHT_LINES = "focus.highlightLines";
const CONF_AUTO_MATCH_LEVEL = "focus.autoMatchLevel";

const CMD_TO_FIXED = "focus.switchToFixedLevel";
const CMD_TO_BLOCK = "focus.switchToBlockLevel";
const CMD_TURN_OFF = "focus.turnOff";

function activate() {

    let baseDecoration = vscode.window.createTextEditorDecorationType({
        opacity: vscode.workspace.getConfiguration().get(CONF_OPACITY)
    });

    vscode.window.onDidChangeTextEditorSelection(() => {
        triggerUpdateDecorations();
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        editor && triggerUpdateDecorations();
    });

    vscode.workspace.onDidChangeConfiguration(listener => {
        if (listener.affectsConfiguration(CONF_OPACITY)) {
            baseDecoration.dispose();
            baseDecoration = vscode.window.createTextEditorDecorationType({
                opacity: vscode.workspace.getConfiguration().get(CONF_OPACITY)
            });
        }
        if((listener.affectsConfiguration(CONF_OPACITY)
            || listener.affectsConfiguration(CONF_HIGHLIGHT_LINES)
            || listener.affectsConfiguration(CONF_HIGHLIGHT_RANGE)
            || listener.affectsConfiguration(CONF_AUTO_MATCH_LEVEL))
            && vscode.window.activeTextEditor){
            triggerUpdateDecorations();
            }
    });

    let timeout = null;
    function triggerUpdateDecorations() {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(updateDecorations, 100);
    }

    function updateDecorations() {
        let activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;
        const ROLL_ABOVE = -1;
        const ROLL_BELOW = 1;
        let range = [];
        let selections = activeEditor.selections.sort((a, b) => a.start.line - b.start.line);
        let rangeType = vscode.workspace.getConfiguration().get(CONF_HIGHLIGHT_RANGE);
        switch (rangeType) {
            case CONF_HIGHLIGHT_RANGE_BLOCK:
                rangeDecoration();
                break;
            case CONF_HIGHLIGHT_RANGE_FIXED:
                let lineCount = (vscode.workspace.getConfiguration().get(CONF_HIGHLIGHT_LINES) -1) / 2;
                fixedDecoration(lineCount);
                break;
            case CONF_HIGHLIGHT_RANGE_NONE:
                noneDecoration();
                break;
        };
        activeEditor.setDecorations(baseDecoration, range);

        function noneDecoration(){
            range.push(new vscode.Range(new vscode.Position(0,0),
            new vscode.Position(0,0)));
        }

        function rangeDecoration() {
            const autoMatchLevel = vscode.workspace.getConfiguration().get(CONF_AUTO_MATCH_LEVEL);

            rollDecoration((position) => {
                return position;
            }, (position, type) => {
                if (autoMatchLevel > 0) {
                    // 正整数：从文档外层向内查找n个级别
                    return findBraceFromOutside(position, type, autoMatchLevel);
                } else if (autoMatchLevel < 0) {
                    // 负整数：从光标位置向外查找n个级别
                    return findBraceFromCursor(position, type, Math.abs(autoMatchLevel));
                }
                // 默认行为（保持向后兼容）
                return findBraceFromCursor(position, type, 1);
            });
        };

        function findBraceFromOutside(position, type, level) {
            // 先收集文档中所有的花括号对
            let bracePairs = [];
            let stack = 0;

            for (let line = 0; line < activeEditor.document.lineCount; line++) {
                let lineString = activeEditor.document.lineAt(line).text;
                for (let char = 0; char < lineString.length; char++) {
                    let charS = lineString.charAt(char);
                    if (charS === '{') {
                        stack++;
                        bracePairs.push({
                            start: new vscode.Position(line, char),
                            level: stack
                        });
                    } else if (charS === '}') {
                        // 找到匹配的开始
                        for (let i = bracePairs.length - 1; i >= 0; i--) {
                            if (bracePairs[i].end === undefined) {
                                bracePairs[i].end = new vscode.Position(line, char + 1);
                                stack--;
                                break;
                            }
                        }
                    }
                }
            }

            // 找到第level层的花括号对
            let targetPair = null;
            for (let pair of bracePairs) {
                if (pair.level === level && pair.end &&
                    position.isAfterOrEqual(pair.start) &&
                    position.isBeforeOrEqual(pair.end)) {
                    targetPair = pair;
                    break;
                }
            }

            if (targetPair) {
                return type === ROLL_ABOVE ? targetPair.start : targetPair.end;
            }

            return new vscode.Position(type === ROLL_ABOVE ? 0 : activeEditor.document.lineCount, 0);
        }

        function findBraceFromCursor(position, type, level) {
            const TOKEN = ['{', '', '}'];
            const TOKEN_BASE = 1;
            var stack = 0;
            var foundLevels = 0;

            for (var line = position.line; line > -1 && line < activeEditor.document.lineCount; line += type) {
                let lineString = activeEditor.document.lineAt(line).text;
                for (var char = line == position.line ? position.character : (type == ROLL_ABOVE ? lineString.length : 0);
                    char > -1 && char <= lineString.length; char += type) {
                    let charS = lineString.charAt(char);
                    if (charS == TOKEN[TOKEN_BASE - type]
                        && !(line == position.line && char == position.character)) {
                        stack++;
                    }
                    if (charS == TOKEN[TOKEN_BASE + type]) {
                        if (stack == 0) {
                            foundLevels++;
                            if (foundLevels === level) {
                                return new vscode.Position(line, type == ROLL_BELOW ? char + 1 : char);
                            }
                        } else {
                            stack--;
                        }
                    }
                }
            }
            return new vscode.Position(type == ROLL_ABOVE ? 0 : activeEditor.document.lineCount, 0);
        }

        function rollDecoration(p, r) {
            for (let i = 0; i < selections.length; i++) {
                if (i == 0) {
                    range.push(new vscode.Range(
                        new vscode.Position(0, 0),
                        p(r(selections[i].start, ROLL_ABOVE), 0)));
                } else {
                    let firstPosition = r(selections[i - 1].end, ROLL_BELOW);
                    let nextPosition = r(selections[i].start, ROLL_ABOVE);
                    if (nextPosition.isAfter(firstPosition)) {
                        range.push(new vscode.Range(
                            p(firstPosition, 1),
                            p(nextPosition, 0)
                        ));
                    }
                }
                if (i == selections.length - 1) {
                    range.push(new vscode.Range(
                        p(r(selections[i].end, ROLL_BELOW), 1),
                        new vscode.Position(activeEditor.document.lineCount, 1)
                    ));
                }
            }
        };

        function fixedDecoration(lineCount) {
            for (let i = 0; i < selections.length; i++) {
                if (i == 0) {
                    range.push(new vscode.Range(
                        new vscode.Position(0, 0),
                        offsetPosition(selections[i].start, -lineCount)));
                } else if (selections[i].start.line - lineCount > selections[i - 1].end.line + lineCount + 1) {
                    range.push(new vscode.Range(
                        offsetPosition(selections[i - 1].end, lineCount + 1),
                        offsetPosition(selections[i].start, -lineCount)));
                }
                if (i == selections.length - 1) {
                    range.push(new vscode.Range(
                        offsetPosition(selections[i].end, lineCount + 1),
                        new vscode.Position(activeEditor.document.lineCount, lineCount + 1)));
                }
            }
        };
    };

    function offsetPosition(position, offset) {
        return new vscode.Position(position.line + offset, 0);
    };

    vscode.commands.registerCommand(CMD_TO_BLOCK, () => {
        vscode.workspace.getConfiguration().update(CONF_HIGHLIGHT_RANGE, CONF_HIGHLIGHT_RANGE_BLOCK, vscode.ConfigurationTarget.Global);
    });
    vscode.commands.registerCommand(CMD_TO_FIXED, () => {
        vscode.workspace.getConfiguration().update(CONF_HIGHLIGHT_RANGE, CONF_HIGHLIGHT_RANGE_FIXED, vscode.ConfigurationTarget.Global);
    });
    vscode.commands.registerCommand(CMD_TURN_OFF,()=>{
        vscode.workspace.getConfiguration().update(CONF_HIGHLIGHT_RANGE,CONF_HIGHLIGHT_RANGE_NONE,vscode.ConfigurationTarget.Global);
    });
}
exports.activate = activate;

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
