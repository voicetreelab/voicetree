# Test Quality Evaluation Prompt

You are evaluating the quality and value of a unit/integration test file.

## Input
- Test file contents
- (Optional) The production code it tests
- (Optional) Other test files in the same area for redundancy check

## Scoring Instructions

### RED FLAGS (0-5 each, 0 = no problem, 5 = extremely problematic)

**1. Mock Overload**
How much does this test rely on mocks/stubs/spies?
- 0: No mocks, or mocks only at true system boundaries (network, filesystem)
- 3: Mocks internal collaborators, testing wiring not behavior
- 5: More mock setup than actual test logic; testing the mocks themselves

**2. Implementation Coupling**
Does this test break when you refactor without changing behavior?
- 0: Tests only public API and observable outcomes
- 3: Tests internal method calls, private state, or specific call sequences
- 5: Tests would break if you renamed a private variable or reordered internals

**3. Redundancy**
Is this test's coverage already provided by other tests?
- 0: Tests unique behavior or edge case
- 3: Significant overlap with other tests, but adds some value
- 5: Completely redundant; deleting this test loses nothing

**4. Unclear Purpose**
Can you state in one sentence what behavior this test verifies?
- 0: Crystal clear what breaks if this test fails
- 3: Vague; tests "that it works" without specificity
- 5: Cannot determine what this test is actually verifying

**5. Fragility / Flakiness**
Is this test deterministic and robust?
- 0: Deterministic, no timing dependencies, no external state
- 3: Relies on specific timing, order-dependent, or environment-sensitive
- 5: Known flaky; passes/fails randomly without code changes

**6. Tautological / Unfalsifiable**
Can this test actually catch bugs?
- 0: Would fail if the behavior it tests was broken
- 3: Tests trivial/obvious things unlikely to break
- 5: Cannot fail (tests constants, mocks return what they're told, asserts nothing meaningful)

---

### GREEN FLAGS (-5 to 0 each, -5 = extremely valuable, 0 = no special value)

**1. Guards Complex Logic**
Does this test protect tricky, bug-prone code?
- -5: Tests algorithmic complexity, state machines, or intricate business rules that are easy to mess up
- -3: Tests moderately complex logic with some edge cases
- 0: Tests straightforward/trivial code

**2. Regression Shield**
Would removing this test risk reintroducing past bugs?
- -5: This test exists because of a real bug that was hard to find/fix
- -3: Tests a known edge case that someone might forget
- 0: No known history of bugs in this area

**3. Documents Critical Behavior**
Does this test serve as executable documentation?
- -5: Reading this test clearly explains how the system should behave; essential for onboarding
- -3: Provides some documentation value for non-obvious behavior
- 0: No documentation value beyond the code itself

**4. Boundary Guardian**
Does this test verify behavior at system boundaries?
- -5: Tests external API contracts, user-facing behavior, or integration points that would be catastrophic to break
- -3: Tests important but internal API boundaries
- 0: Tests internal implementation details

---

### REDUCIBILITY ASSESSMENT

Evaluate whether this test file could be significantly shortened while retaining most of its value.

Consider:
- Verbose setup that could be extracted or simplified
- Repetitive test cases that could be parameterized
- Unnecessary assertions that don't add coverage
- Copy-pasted boilerplate
- Tests that could be consolidated

Provide a tuple: `(removal_percentage, value_retained_percentage)`
- removal_percentage: What % of the file (by lines) could be removed/simplified?
- value_retained_percentage: What % of the test's value would remain after that reduction?

Example: `(60%, 95%)` = "60% of this file could be cut while keeping 95% of its value"

---

## Output Format

```json
{
  "badness": {
    "mock_overload": <0-5>,
    "implementation_coupling": <0-5>,
    "redundancy": <0-5>,
    "unclear_purpose": <0-5>,
    "fragility": <0-5>,
    "tautological": <0-5>,
    "total": <0-30>
  },
  "goodness": {
    "guards_complex_logic": <-5 to 0>,
    "regression_shield": <-5 to 0>,
    "documents_critical_behavior": <-5 to 0>,
    "boundary_guardian": <-5 to 0>,
    "total": <-20 to 0>
  },
  "reducibility": {
    "removal_percentage": <0-100>,
    "value_retained_percentage": <0-100>
  },
  "net_score": <badness.total + goodness.total>,
  "comment": "<1-3 sentence summary: what this test does well/poorly, and recommendation (keep/reduce/delete/rewrite)>"
}
```

## Interpretation

- **net_score < -10**: High-value test, protect it
- **net_score -10 to 0**: Decent test, keep unless reducing scope
- **net_score 0 to 10**: Marginal value, candidate for reduction or deletion
- **net_score > 10**: Actively harmful, delete or completely rewrite

- **reducibility (>40%, >80%)**: Strong candidate for refactoring to slim version
