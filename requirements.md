# Requirements

- R1 [http HEAD /]: No response carries both Content-Length and Transfer-Encoding.
- R2 [http HEAD /]: The voicetree.io site tells browsers to use HTTPS only, with a Strict-Transport-Security header.
- R3 [http HEAD /]: The www.voicetree.io host permanently redirects to the voicetree.io site.
- R4 [http HEAD /upload]: The share worker returns no shared content to a HEAD request on its upload path.
- R5: None of these endpoints sets a cookie.
