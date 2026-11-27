"""Cookie jar helpers of the virtual computer server: python3 -m unittest vm-agent/test_cookies.py"""
import importlib.util
import os
import unittest

spec = importlib.util.spec_from_file_location("vm", os.path.join(os.path.dirname(__file__), "neuralnetui_vm.py"))
vm = importlib.util.module_from_spec(spec); spec.loader.exec_module(vm)


def c(name, value, domain="example.com", **extra):
    return {"name": name, "value": value, "domain": domain, "path": "/", "secure": True, "httpOnly": False, "sameSite": "Lax", "expires": None, "hostOnly": False, **extra}


class CookieTests(unittest.TestCase):
    def test_merge_keeps_other_sessions_and_edits(self):
        seed = [c("a", "1"), c("b", "1"), c("gone", "1")]
        account = [c("a", "1"), c("b", "edited"), c("gone", "1"), c("other", "from another session")]
        final = [c("a", "2"), c("b", "1"), c("new", "x")]          # changed a, left b alone, removed gone, added new
        merged = {x["name"]: x["value"] for x in vm.merge_cookies(account, seed, final)}
        self.assertEqual(merged, {"a": "2", "b": "edited", "other": "from another session", "new": "x"})

    def test_removal_does_not_drop_a_cookie_changed_meanwhile(self):
        merged = vm.merge_cookies([c("a", "edited")], [c("a", "1")], [])
        self.assertEqual([x["value"] for x in merged], ["edited"])

    def test_netscape_round_trip(self):
        jar = [c("sid", "abc", "naver.com", httpOnly=True, expires=1830216413, sameSite="None"),
               c("pref", "x y", "www.example.com", hostOnly=True, secure=False)]
        text = vm.cookies_to_netscape(jar)
        self.assertIn("#HttpOnly_.naver.com\tTRUE\t/\tTRUE\t1830216413\tsid\tabc", text)
        self.assertIn("www.example.com\tFALSE\t/\tFALSE\t0\tpref\tx y", text)
        back, problems = vm.netscape_to_cookies(text, jar)
        self.assertEqual(problems, [])
        self.assertEqual(sorted(back, key=lambda x: x["name"]), sorted(jar, key=lambda x: x["name"]))

    def test_netscape_import_defaults_and_problems(self):
        cookies, problems = vm.netscape_to_cookies(".youtube.com\tTRUE\t/\tTRUE\t0\tPREF\tf6=40000000\nbroken line\n# comment\n\n")
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["sameSite"], "Lax")
        self.assertIsNone(cookies[0]["expires"])
        self.assertFalse(cookies[0]["hostOnly"])
        self.assertEqual(len(problems), 1)


if __name__ == "__main__":
    unittest.main()
