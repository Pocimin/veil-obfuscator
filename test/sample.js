// Sample program used by the test harness and CLI demo.
function greet(name) {
  const prefix = "Hello, ";
  return prefix + name;
}

const subject = "world";
const message = greet(subject);

console.log(message);
console.log("veil says:", message);
