# JavaScript Scanner

A simple and fast **JavaScript secrets & endpoints scanner** built with Python.  
This tool scans a `javascript.js` file and extracts:

- Sensitive data (API keys, tokens, secrets, emails, etc.)
- Endpoints (API routes, URLs, Firebase links, etc.)

It uses regex patterns defined in `config.json`.

---

## What This Tool Does

1. Reads the selected program name from `program.json`
2. Locates the JavaScript file:
   ```
   W:\BugBounty\<program_name>\javascript.js
   ```
3. Loads regex patterns from `config.json`
4. Scans the file for:
   - Secrets
   - Endpoints
5. Displays results in a clean formatted output using **Rich**

---

## IMPORTANT

`config.json` and `program.json`  
**MUST be in the same directory as the executable (.exe) or main.py**

The scanner will NOT work if those files are missing.

---

## Requirements

Install dependencies:
```bash
pip install -r requirements.txt
```

