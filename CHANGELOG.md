# CHANGELOG

## (Version #) - (Date)

## 2026-03-05

### Added

* Added [Mailpit](https://mailpit.axllent.org/) for local email capture with a web UI at http://localhost:8025
* Changed `ACCOUNT_EMAIL_VERIFICATION` from `"none"` to `"optional"` now that local email delivery works via Mailpit


## 2026-01-25

### Changed

* Upgraded epicenv to v1.2 and switched to using the built-in `epicenv.initializers.url_safe_password` function for generating `SECRET_KEY` and `POSTGRES_PASSWORD`


## 2026-01-24

### Added

* Added support for remote debugging with VS Code, PyCharm, and LazyVim/Neovim
* Added debugpy as a development dependency for Python debugging
* Added `just create_env` command for .env file generation with backup support
* Added comprehensive debugging documentation in docs/debugging.md
* Added debugging support section to README

### Changed

* Modernized navbar with offcanvas menu and improved mobile UX
* Improved VS Code debugging workflow with simplified two-step process
* Refactored ENABLE_DEBUGGER to USE_DEBUGPY for consistency
* Refactored .env creation into separate script with backup support
* Bumped uv-dependencies group with 7 updates
* Bumped development-dependencies group with 2 updates
* Bumped Node from 25.3 to 25.4

### Fixed

* Fixed jumbotron button overflow on mobile devices
* Fixed start_new_project script to work on Linux and enhanced CI verification


## 2025-12-19

### Changed

* Switched from MyPy to Ty for Python type checking. Ty is a fast, modern type checker from Astral that provides significantly better performance than MyPy.


## 2025-06-06

### Added

### Changed

### Removed
