import 'config/base.just'

project_slug := 'budgeteer'

# List available commands
@_default:
    just -l

# Create or regenerate .env file from pyproject.toml schema
@create_env:
    uvx epicenv create

# Upgrade both Python and Node
@upgrade_all_packages:
    # kill all running containers
    docker stop $(docker ps -a -q) || true
    # remove all stopped containers
    docker rm $(docker ps -a -q) || true
    just start
    just upgrade_python_packages
    just upgrade_node_packages
    just build
    just pre_commit

@makemigrations *args:
    {{ python_cmd_prefix }} ./manage.py makemigrations {{ args }}

@migrate *args:
    {{ python_cmd_prefix }} ./manage.py migrate {{ args }}

# Serve docs locally with Zensical at http://localhost:4000
@docs:
    uv run zensical serve -f zensical.toml

# Build the static docs site into docs_site/
@docs_build:
    uv run zensical build -f zensical.toml --clean
