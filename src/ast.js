// Minimal AST node builders. Keeps transforms free of acorn internals.

export function Identifier(name) {
  return { type: "Identifier", name };
}

export function Literal(value, raw) {
  return { type: "Literal", value, raw };
}

export function StringLiteral(str) {
  return { type: "Literal", value: str, raw: JSON.stringify(str) };
}

export function NumberLiteral(n) {
  return { type: "Literal", value: n, raw: String(n) };
}

export function ArrayExpression(elements) {
  return { type: "ArrayExpression", elements };
}

export function ObjectExpression(properties) {
  return { type: "ObjectExpression", properties };
}

export function Property(key, value, kind = "init", shorthand = false) {
  return { type: "Property", key, value, kind, method: false, shorthand, computed: false };
}

export function MemberExpression(object, property, computed = false) {
  return {
    type: "MemberExpression",
    object,
    property,
    computed,
    optional: false,
  };
}

export function CallExpression(callee, args = []) {
  return { type: "CallExpression", callee, arguments: args, optional: false };
}

export function NewExpression(callee, args = []) {
  return { type: "NewExpression", callee, arguments: args };
}

export function AssignmentExpression(operator, left, right) {
  return { type: "AssignmentExpression", operator, left, right };
}

export function BinaryExpression(operator, left, right) {
  return { type: "BinaryExpression", operator, left, right };
}

export function VariableDeclaration(kind, declarators) {
  return { type: "VariableDeclaration", kind, declarations: declarators };
}

export function VariableDeclarator(id, init) {
  return { type: "VariableDeclarator", id, init };
}

export function ExpressionStatement(expression) {
  return { type: "ExpressionStatement", expression };
}

export function BlockStatement(body) {
  return { type: "BlockStatement", body };
}

export function SequenceExpression(expressions) {
  return { type: "SequenceExpression", expressions };
}

export function FunctionExpression(id, params, body) {
  return { type: "FunctionExpression", id, params, body, generator: false, async: false };
}

export function FunctionDeclaration(id, params, body) {
  return { type: "FunctionDeclaration", id, params, body, generator: false, async: false };
}

export function ReturnStatement(argument) {
  return { type: "ReturnStatement", argument };
}

export function IfStatement(test, consequent, alternate = null) {
  return { type: "IfStatement", test, consequent, alternate };
}

export function ForStatement(init, test, update, body) {
  return { type: "ForStatement", init, test, update, body };
}

export function WhileStatement(test, body) {
  return { type: "WhileStatement", test, body };
}

export function SwitchStatement(discriminant, cases) {
  return { type: "SwitchStatement", discriminant, cases };
}

export function SwitchCase(test, consequent) {
  return { type: "SwitchCase", test, consequent };
}

export function BreakStatement() {
  return { type: "BreakStatement", label: null };
}

export function ContinueStatement() {
  return { type: "ContinueStatement", label: null };
}

export function UnaryExpression(operator, argument, prefix = true) {
  return { type: "UnaryExpression", operator, argument, prefix };
}

export function LogicalExpression(operator, left, right) {
  return { type: "LogicalExpression", operator, left, right };
}

export function ThisExpression() {
  return { type: "ThisExpression" };
}
