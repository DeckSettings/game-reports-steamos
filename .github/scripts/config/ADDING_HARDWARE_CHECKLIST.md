# Adding New Hardware Checklist

> [!NOTE]
> Name the device using the format `<Manufacturer> <Device Name> <Revision>`.

> [!NOTE]
> Insert the hardware entry in all files mentioned below in alphabetical order.

> [!NOTE]
> The four required `game-reports-steamos` files for new hardware support are:
> `.github/ISSUE_TEMPLATE/GAME-REPORT.yml`,
> `.github/scripts/config/game-report-validation.json`,
> `.github/scripts/config/hardware.json`,
> `.github/scripts/config/labels.json`.

> [!NOTE]
> Do not rely only on the hardware request issue body. Verify the submitted specs against official sources first, preferably the manufacturer product page and a vendor spec sheet / PSREF page when available. Confirm key fields such as battery size, display resolution, refresh rate, VRR support, max TDP, and clock values, and watch for model variants that may have different specs.

- [ ] Update `.github/scripts/config/hardware.json` with the new device details.
- [ ] Update `.github/scripts/config/labels.json` with the new device details.
- [ ] Publish the labels to the project with `github_import_repo_issue_labels DeckSettings/game-reports-steamos .github/scripts/config/labels.json`
- [ ] Add the hardware option to `.github/scripts/config/game-report-validation.json` so reports get validated.
- [ ] Update `.github/ISSUE_TEMPLATE/GAME-REPORT.yml` to include the device.
- [ ] Add the device images to `deck-verified-site/packages/frontend/public/devices/`.
- [ ] Add `-large` and `-small` images for the device using the naming convention `<vendor>-<device>-large.png` and `<vendor>-<device>-small.png`.
- [ ] Update `deck-verified-site/packages/frontend/src/components/elements/DeviceImage.vue` so the new device name resolves to the correct image prefix.
- [ ] Follow `deck-verified-site/packages/frontend/public/devices/README.md` for the image workflow.
- [ ] If scripting image generation, the equivalent ImageMagick commands are:

```bash
convert source.png -trim +repage -resize 1000x -background none -gravity center -extent 1000x400 <vendor>-<device>-large.png
convert source.png -trim +repage -resize 250x -background none -gravity center -extent 250x100 <vendor>-<device>-small.png
```

- [ ] Verify the generated files with `identify <file.png>` and confirm the final sizes are `1000x400` and `250x100`.

## Scope Notes

- The backend in `deck-verified-site` reads `game-reports-steamos/.github/scripts/config/hardware.json`, so no backend code change is normally required for new hardware entries.
- `DeviceImage.vue` is required for hardware-specific art on the frontend. Without it, the site falls back to the placeholder image.
- Homepage showcase components such as `SupportedDevicesParallax.vue` or `HomeSupportedDevicesSection.vue` only need updates if the new hardware should be featured in marketing/support sections.

## Retiring Hardware Names

When an old hardware name should no longer be available for new submissions, but existing reports must still work:

- Remove the retired device from `.github/ISSUE_TEMPLATE/GAME-REPORT.yml` so new reports cannot select it.
- Keep the retired string in `.github/scripts/config/game-report-validation.json` if existing reports may still be edited or revalidated.
- Remove the standalone retired entry from `.github/scripts/config/hardware.json`.
- Add the retired string to the replacement device entry as an `aliases` value in `.github/scripts/config/hardware.json`.
- Remove the standalone retired label from `.github/scripts/config/labels.json`.
- Expand the replacement device label regex in `.github/scripts/config/labels.json` so old report strings still receive the correct label.
- Update `deck-verified-site/packages/frontend/src/components/elements/DeviceImage.vue` so the retired string resolves to the replacement device artwork.
- If backend matching depends on exact device names, update the consuming code to support aliases before removing the old hardware entry.
- If a generic retired name later splits into multiple variants and the original report string is ambiguous, default the legacy alias to the higher-end replacement device unless there is strong evidence that the old reports were predominantly submitted on the lower-end hardware. It is safer for legacy reports to understate expected performance than to overstate it.
