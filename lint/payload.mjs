// Payload's Local API skips every access function unless told not to, and a call
// that reads as the caller looks just like one that doesn't. So each call states
// which it is, as a literal: a computed flag is how the shared rows guard read
// documents for callers who weren't allowed to see them. A spread is followed
// to its local `const`, since most calls here share their options that way.

const LOCAL_API_METHODS = new Set([
  "count",
  "countGlobalVersions",
  "countVersions",
  "create",
  "delete",
  "duplicate",
  "find",
  "findByID",
  "findDistinct",
  "findGlobal",
  "findGlobalVersionByID",
  "findGlobalVersions",
  "findVersionByID",
  "findVersions",
  "forgotPassword",
  "login",
  "resetPassword",
  "restoreGlobalVersion",
  "restoreVersion",
  "unlock",
  "update",
  "updateGlobal",
]);

const WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

const unwrap = (node) => (WRAPPERS.has(node.type) ? unwrap(node.expression) : node);

function isLocalApiCall({ callee }) {
  if (callee.type !== "MemberExpression" || !LOCAL_API_METHODS.has(callee.property.name)) {
    return false;
  }
  const object = unwrap(callee.object);
  return object.name === "payload" || object.property?.name === "payload";
}

/** The object literal a local `const` holds, if that's what this node is. */
function resolveObject(node, scope) {
  const target = unwrap(node);
  if (target.type === "ObjectExpression") return target;
  if (target.type !== "Identifier") return undefined;
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(target.name);
    if (!variable) continue;
    const [definition] = variable.defs;
    if (definition?.type !== "Variable" || definition.parent?.kind !== "const") return undefined;
    const init = definition.node.init && unwrap(definition.node.init);
    return init?.type === "ObjectExpression" ? init : undefined;
  }
  return undefined;
}

/**
 * What decides `overrideAccess` in these options, last property first because
 * the last one wins: its value node, `"unseen"` for a spread that can't be
 * followed, or undefined when nothing sets it.
 */
function findFlag(options, scope) {
  for (const property of [...options.properties].reverse()) {
    if (property.type === "SpreadElement") {
      const spread = resolveObject(property.argument, scope);
      if (!spread) return "unseen";
      const flag = findFlag(spread, scope);
      if (flag) return flag;
    } else if (property.key.name === "overrideAccess" && !property.computed) {
      return property.value;
    }
  }
  return undefined;
}

const isBoolean = (node) => node.type === "Literal" && typeof node.value === "boolean";

const plugin = {
  meta: { name: "payload" },
  rules: {
    "explicit-override-access": {
      meta: {
        type: "problem",
        messages: {
          missing:
            "Payload Local API calls must state `overrideAccess`: the default is `true`, which skips every access function. `false` runs as the caller; `true` claims this is trusted server code.",
          notLiteral:
            "`overrideAccess` must be a literal `true` or `false`, so a reader can see which this call is. If it has to be computed, disable this rule here and say why.",
          unseen:
            "This spread may set `overrideAccess` and can't be followed. State the flag after it, or spread a local `const` object.",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isLocalApiCall(node)) return;
            const scope = context.sourceCode.getScope(node);
            const [argument] = node.arguments;
            const options = argument && resolveObject(argument, scope);
            if (argument && !options) return context.report({ node, messageId: "unseen" });
            const flag = options && findFlag(options, scope);
            if (flag === "unseen") return context.report({ node, messageId: "unseen" });
            if (!flag) return context.report({ node, messageId: "missing" });
            if (!isBoolean(flag)) context.report({ node: flag, messageId: "notLiteral" });
          },
        };
      },
    },
  },
};

export default plugin;
