---
node_id: 999
title: Syntax Highlighting Test
---

# This is a Header 1

## This is a Header 2

### This is a Header 3

**This text should be bold**

*This text should be italic*

- Bullet item 1
- Bullet item 2
- Bullet item 3

Here's some TypeScript code:

```typescript
interface User {
  name: string;
  age: number;
}

function greetUser(user: User): string {
  return `Hello, ${user.name}! You are ${user.age} years old.`;
}

const myUser: User = { name: "Alice", age: 30 };
console.log(greetUser(myUser));
```

Here's some Python code:

```python
class Person:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age
    
    def greet(self) -> str:
        return f"Hello, {self.name}! You are {self.age} years old."

# Create instance
person = Person("Bob", 25)
print(person.greet())
```

Here's some JSON:

```json
{
  "name": "Test",
  "version": "1.0.0",
  "features": [
    "syntax highlighting",
    "live preview",
    "both working together"
  ],
  "working": true
}
```

## Success!

Both **live markdown preview** and *code block syntax highlighting* work simultaneously!
