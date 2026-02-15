import os
import sys
import re
import json
from rich.console import Console
from rich.panel import Panel
from rich.align import Align
from rich.progress import Progress, SpinnerColumn, TextColumn

console = Console()

if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
PROGRAM_FILE = os.path.join(BASE_DIR, "program.json")


def print_banner():
    banner = """
                                                            
   ▄▄▄▄▄▄                  ▄▄▄▄▄                            
  █▀ ██                   ██▀▀▀▀█▄                     █▄   
     ██                   ▀██▄  ▄▀       ▄    ▀▀      ▄██▄  
     ██ ▄▀▀█▄▀█▄ ██▀▄▀▀█▄   ▀██▄▄  ▄███▀ ████▄██ ████▄ ██   
     ██ ▄█▀██ ██▄██ ▄█▀██ ▄   ▀██▄ ██    ██   ██ ██ ██ ██   
     ██▄▀█▄██  ▀█▀ ▄▀█▄██ ▀██████▀▄▀███▄▄█▀  ▄██▄████▀▄██   
 ▄   ██                                          ██         
 ▀████▀                                          ▀          
                                                            
        ▄▄▄▄▄                                               
       ██▀▀▀▀█▄                                             
       ▀██▄  ▄▀             ▄     ▄           ▄             
         ▀██▄▄  ▄███▀ ▄▀▀█▄ ████▄ ████▄ ▄█▀█▄ ████▄         
       ▄   ▀██▄ ██    ▄█▀██ ██ ██ ██ ██ ██▄█▀ ██            
       ▀██████▀▄▀███▄▄▀█▄██▄██ ▀█▄██ ▀█▄▀█▄▄▄▄█▀            
                                                            
"""
    console.print(Panel(Align.center(banner), border_style="bold cyan"))


def load_json(file):
    with open(file, "r", encoding="utf-8") as f:
        return json.load(f)


def scan_with_spinner(content, patterns, title):
    results = set()

    with Progress(
        SpinnerColumn(style="cyan"),
        TextColumn(f"[bold cyan]{title.upper()}..."),
        transient=True,
        console=console,
    ) as progress:
        task = progress.add_task(title.upper(), start=False)
        progress.start_task(task)

        for pattern in patterns:
            matches = re.findall(pattern, content)
            for match in matches:
                if isinstance(match, tuple):
                    match = " ".join([m for m in match if m])
                results.add(str(match))

    return results


def main():
    print_banner()

    if not os.path.exists(PROGRAM_FILE):
        console.print(Panel("[red]program.json NOT FOUND[/red]", border_style="red"))
        return

    program_data = load_json(PROGRAM_FILE)
    program_name = program_data.get("program_name")

    if not program_name:
        console.print(
            Panel(
                "[red]PROGRAM NAME IS EMPTY IN program.json[/red]", border_style="red"
            )
        )
        return

    console.print(
        Panel(
            f"[bold green]CURRENT PROGRAM:[/bold green] [cyan]{program_name}[/cyan]",
            border_style="green",
        )
    )

    file_path = rf"W:\BugBounty\{program_name}\javascript.js"

    if not os.path.exists(file_path):
        console.print(
            Panel(
                f"[red]javascript.js NOT FOUND IN {file_path}[/red]",
                border_style="red",
            )
        )
        return

    if not os.path.exists(CONFIG_FILE):
        console.print(Panel("[red]config.json NOT FOUND[/red]", border_style="red"))
        return

    config = load_json(CONFIG_FILE)

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    secret_results = scan_with_spinner(
        content, config["secret_patterns"], "Scanning For Secrets"
    )

    endpoint_results = scan_with_spinner(
        content, config["endpoint_patterns"], "Scanning For Endpoints"
    )

    console.print(
        Panel(
            f"[bold green]SECRETS FOUND:[/bold green] [cyan]{len(secret_results)}[/cyan]",
            border_style="green",
        )
    )

    for item in sorted(secret_results):
        console.print(f"[red][+][/red] [yellow]{item}[/yellow]")

    console.print(
        Panel(
            f"[bold green]ENDPOINTS FOUND:[/bold green] [cyan]{len(endpoint_results)}[/cyan]",
            border_style="green",
        )
    )

    for item in sorted(endpoint_results):
        console.print(f"[red][+][/red] [yellow]{item}[/yellow]")

    console.print(
        Panel(
            "[bold blue]✔ SCAN COMPLETED SUCCESSFULLY![/bold blue]",
            border_style="blue",
            padding=(1, 4),
        )
    )

    input("\nPress ENTER to exit...")


if __name__ == "__main__":
    main()
