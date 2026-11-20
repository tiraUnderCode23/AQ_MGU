"""Validate localization-root initialization without importing any app builder.

Only the selected assignment expression is evaluated in a constrained namespace
with a simulated directory map. No source build, install or external I/O runs.
"""
import ast
import os
from pathlib import Path
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[1]
BUILDERS = (
    "apps/_sources/c365-mgu-drive/kit/tools/build.py",
    "apps/_sources/markoni-homeassistant/kit/tools/build.py",
    "apps/_sources/tjmodsss-tjm-apps/kit/tools/build.py",
    "apps/_sources/grabandrey-m-drive-control/kit/tools/build.py",
    "apps/_sources/benspa900-mon-vitals/kit/tools/build.py",
    "apps/_sources/cruzen991-cluster/kit/tools/build.py",
    "apps/_sources/dimonprograms-apps/kit/tools/build.py",
    "apps/_sources/dinerboy-ahg-mgu/kit/tools/build.py",
    "apps/_sources/prototype019-idrive7-motordaten/kit/tools/build.py",
    "apps/_ports/dimonprograms-idrive8/kit/tools/build.py",
    "apps/_ports/dante-idrive8/kit/tools/build.py",
)


def isolated_initializer(relative):
    """Select and constrain the expression; never compile the builder module."""
    tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"),
                     filename=relative)
    assignments = [
        node for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "_AQ_LOC_ROOT"
                for target in node.targets)
    ]
    if len(assignments) != 1:
        raise AssertionError(relative + ": expected one localization initializer")
    expression = ast.Expression(body=assignments[0].value)
    allowed_nodes = (
        ast.Expression, ast.IfExp, ast.Call, ast.Attribute, ast.Name,
        ast.Load, ast.Store, ast.List, ast.GeneratorExp, ast.comprehension,
        ast.Constant,
    )
    for node in ast.walk(expression):
        if not isinstance(node, allowed_nodes):
            raise AssertionError("Unexpected initializer syntax: " + type(node).__name__)
        if isinstance(node, ast.Name) and node.id not in {"KIT", "os", "next", "p"}:
            raise AssertionError("Uninitialized or unreviewed name: " + node.id)
        if isinstance(node, ast.Attribute) and node.attr not in {
                "path", "isdir", "join", "abspath"}:
            raise AssertionError("Unreviewed initializer attribute: " + node.attr)
        if isinstance(node, ast.Constant) and not isinstance(node.value, str):
            raise AssertionError("Expected path literals only")
    return compile(ast.fix_missing_locations(expression), relative, "eval")


def select_root(expression, kit, existing_directories):
    def normalized(path):
        return os.path.normcase(os.path.abspath(path))

    existing = {normalized(path) for path in existing_directories}
    inspected = []

    def isdir(path):
        inspected.append(normalized(path))
        return normalized(path) in existing

    simulated_os = SimpleNamespace(path=SimpleNamespace(
        isdir=isdir, join=os.path.join, abspath=os.path.abspath,
    ))
    namespace = {
        "__builtins__": {},
        "KIT": str(kit),
        "os": simulated_os,
        "next": next,
    }
    return eval(expression, namespace), inspected


class SharedLocalizationBootstrapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expressions = {
            relative: isolated_initializer(relative) for relative in BUILDERS
        }
        cls.canonical = ROOT / "apps/_sources/idrive7-apps/kit"

    def test_local_localization_wins_even_when_canonical_is_available(self):
        for relative, expression in self.expressions.items():
            kit = (ROOT / relative).parents[1]
            with self.subTest(builder=relative):
                selected, inspected = select_root(
                    expression, kit,
                    [kit / "localization", self.canonical / "localization"],
                )
                self.assertEqual(Path(selected), kit)
                self.assertEqual(inspected, [
                    os.path.normcase(os.path.abspath(kit / "localization"))
                ])

    def test_canonical_localization_resolves_for_source_and_port_layouts(self):
        for relative, expression in self.expressions.items():
            kit = (ROOT / relative).parents[1]
            with self.subTest(builder=relative):
                selected, _ = select_root(
                    expression, kit, [self.canonical / "localization"],
                )
                self.assertEqual(Path(selected), self.canonical)

    def test_missing_localization_preserves_original_kit_fallback(self):
        for relative, expression in self.expressions.items():
            kit = (ROOT / relative).parents[1]
            with self.subTest(builder=relative):
                selected, _ = select_root(expression, kit, [])
                self.assertEqual(Path(selected), kit)

    def test_directory_without_localization_is_not_a_valid_shared_root(self):
        for relative, expression in self.expressions.items():
            kit = (ROOT / relative).parents[1]
            with self.subTest(builder=relative):
                selected, _ = select_root(expression, kit, [kit, self.canonical])
                self.assertEqual(Path(selected), kit)


if __name__ == "__main__":
    unittest.main()
