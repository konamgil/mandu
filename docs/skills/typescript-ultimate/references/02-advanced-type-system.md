# 02) Advanced Type System

## Use in this order

1. Clear domain model (interfaces/type aliases)
2. Union + discriminant for variants
3. Generics for reuse
4. Conditional/mapped/template-literal helpers for DRY
5. Recursive/deep types only when necessary

## Core patterns

- Generics with constraints (`<T extends Constraint>`)
- Conditional types with `infer`
- Mapped types for transformations (`Readonly`, `Partial`, keyed remap)
- Template literal types for event keys/paths
- Utility types (`Pick`, `Omit`, `Extract`, `Exclude`, `Record`, `NonNullable`)

## Reliability patterns

- Exhaustive switch:

```ts
const _never: never = value;
```

- Branded IDs:

```ts
type UserId = string & { readonly __brand: 'UserId' };
```

- Deep readonly / deep partial only at boundaries (avoid overuse in internals).

## Anti-patterns

- Over-engineered type gymnastics that reduce readability.
- Type-level recursion without depth controls.
- Assertions instead of narrowing.
