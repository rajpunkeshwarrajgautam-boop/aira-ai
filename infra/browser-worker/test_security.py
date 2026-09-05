import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import server


class _Frame:
    def __init__(self, parent_frame=None):
        self.parent_frame = parent_frame


class _Page:
    def __init__(self):
        self.main_frame = _Frame()


class _Request:
    def __init__(self, url, frame, navigation=True):
        self.url = url
        self.frame = frame
        self._navigation = navigation

    def is_navigation_request(self):
        return self._navigation


class _Route:
    def __init__(self, request):
        self.request = request
        self.aborted = False
        self.continued = False

    async def abort(self, _reason):
        self.aborted = True

    async def continue_(self):
        self.continued = True


class BrowserSecurityPolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_domain_scope_accepts_exact_and_subdomain_only(self):
        allowed = ("example.com",)
        self.assertTrue(server._domain_allowed("example.com", allowed))
        self.assertTrue(server._domain_allowed("app.example.com", allowed))
        self.assertFalse(server._domain_allowed("evil-example.com", allowed))
        self.assertFalse(server._domain_allowed("example.com.evil.test", allowed))

    def test_literal_private_and_special_addresses_are_blocked(self):
        blocked = [
            "127.0.0.1",
            "0.0.0.0",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
        ]
        for address in blocked:
            with self.subTest(address=address):
                self.assertFalse(server._literal_address_is_public(address))
        self.assertTrue(server._literal_address_is_public("1.1.1.1"))
        self.assertTrue(server._literal_address_is_public("2606:4700:4700::1111"))

    async def test_localhost_names_are_blocked_before_dns(self):
        for hostname in ("localhost", "service.localhost", "printer.local"):
            with self.subTest(hostname=hostname):
                with self.assertRaises(HTTPException):
                    await server._assert_public_host(hostname)

    async def test_dns_rebinding_to_private_address_fails_closed(self):
        private_result = [
            (2, 1, 6, "", ("127.0.0.1", 0)),
            (2, 1, 6, "", ("169.254.169.254", 0)),
        ]
        with patch.object(server.socket, "getaddrinfo", return_value=private_result):
            with self.assertRaises(HTTPException) as caught:
                await server._assert_public_host("public.example")
        self.assertEqual(caught.exception.status_code, 400)

    async def test_public_dns_result_is_allowed(self):
        public_result = [(2, 1, 6, "", ("1.1.1.1", 0))]
        with patch.object(server.socket, "getaddrinfo", return_value=public_result):
            await server._assert_public_host("public.example")

    async def test_validate_url_enforces_protocol_domain_scope_and_no_credentials(self):
        public_result = [(2, 1, 6, "", ("1.1.1.1", 0))]
        with patch.object(server.socket, "getaddrinfo", return_value=public_result):
            accepted = await server._validate_url(
                "https://app.example.com/path",
                ("example.com",),
                require_allowed=True,
            )
            self.assertEqual(accepted, "https://app.example.com/path")
            with self.assertRaises(HTTPException) as denied:
                await server._validate_url(
                    "https://example.net/escape",
                    ("example.com",),
                    require_allowed=True,
                )
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException):
                await server._validate_url(
                    "file:///etc/passwd",
                    ("example.com",),
                    require_allowed=True,
                )
            for value in (
                "https://user:secret@example.com/path",
                "https://user@example.com/path",
            ):
                with self.subTest(value=value):
                    with self.assertRaises(HTTPException) as credentialed:
                        await server._validate_url(value, ("example.com",), require_allowed=True)
                    self.assertEqual(credentialed.exception.status_code, 400)

    async def test_route_revalidates_redirects_and_blocks_domain_escape(self):
        page = _Page()
        state = server.SessionState(
            session_id="session-12345678",
            context=None,
            page=page,
            allowed_domains=("example.com",),
            created_at=time.time(),
            expires_at=time.time() + 60,
        )
        public_result = [(2, 1, 6, "", ("1.1.1.1", 0))]
        with patch.object(server.socket, "getaddrinfo", return_value=public_result):
            allowed = _Route(_Request("https://app.example.com/next", page.main_frame))
            await server._safe_route(state, allowed)
            self.assertTrue(allowed.continued)
            self.assertFalse(allowed.aborted)

            escaped = _Route(_Request("https://evil.example.net/redirect", page.main_frame))
            await server._safe_route(state, escaped)
            self.assertTrue(escaped.aborted)
            self.assertFalse(escaped.continued)

    async def test_route_blocks_popup_main_frames_and_credential_urls(self):
        page = _Page()
        state = server.SessionState(
            session_id="session-12345678",
            context=None,
            page=page,
            allowed_domains=("example.com",),
            created_at=time.time(),
            expires_at=time.time() + 60,
        )
        public_result = [(2, 1, 6, "", ("1.1.1.1", 0))]
        with patch.object(server.socket, "getaddrinfo", return_value=public_result):
            popup = _Route(_Request("https://example.com/popup", _Frame()))
            await server._safe_route(state, popup)
            self.assertTrue(popup.aborted)

            credentialed = _Route(_Request("https://user:secret@example.com/path", page.main_frame))
            await server._safe_route(state, credentialed)
            self.assertTrue(credentialed.aborted)

    async def test_route_rejects_dns_rebinding_after_navigation_starts(self):
        page = _Page()
        state = server.SessionState(
            session_id="session-12345678",
            context=None,
            page=page,
            allowed_domains=("example.com",),
            created_at=time.time(),
            expires_at=time.time() + 60,
        )
        private_result = [(2, 1, 6, "", ("169.254.169.254", 0))]
        route = _Route(_Request("https://example.com/redirect", page.main_frame))
        with patch.object(server.socket, "getaddrinfo", return_value=private_result):
            await server._safe_route(state, route)
        self.assertTrue(route.aborted)
        self.assertFalse(route.continued)


if __name__ == "__main__":
    unittest.main()
