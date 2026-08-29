import unittest
from unittest.mock import patch

from fastapi import HTTPException

import server


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

    async def test_validate_url_enforces_protocol_and_domain_scope(self):
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


if __name__ == "__main__":
    unittest.main()
