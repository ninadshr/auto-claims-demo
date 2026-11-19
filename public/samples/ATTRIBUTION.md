# Sample Image Attribution

All sample images in this directory come from [Wikimedia Commons](https://commons.wikimedia.org/).
Each was resized to ≤1280 px width for demo use. Original file pages include full license text.

| Local file | Commons source | Author | License |
| :--- | :--- | :--- | :--- |
| `accident_damaged_car.jpg` | [Sebring Sedan Accident.jpg](https://commons.wikimedia.org/wiki/File:Sebring_Sedan_Accident.jpg) | Ryanandlenny | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| `broken_front_bumper.jpg` | [Front bumper broken.jpg](https://commons.wikimedia.org/wiki/File:Front_bumper_broken.jpg) | Tiia Monto | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `citroen_missing_front_bumper.jpg` | [2000 Chrysler Cirrus with missing bumper.jpg](https://commons.wikimedia.org/wiki/File:2000_Chrysler_Cirrus_with_missing_bumper.jpg) | Nyttend | [Public domain](https://en.wikipedia.org/wiki/Public_domain) |
| `clean_car.jpg` | [1995 Mercury Sable GS sedan, front left, 04-11-2021.jpg](https://commons.wikimedia.org/wiki/File:1995_Mercury_Sable_GS_sedan,_front_left,_04-11-2021.jpg) | MercurySable99 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Notes for the demo's four routing scenarios:

- `accident_damaged_car.jpg` — severe front-end collision (expected route: **ESCALATE**)
- `broken_front_bumper.jpg` — moderate bumper damage (**AUTO_APPROVE** candidate)
- `citroen_missing_front_bumper.jpg` — vehicle-ID disagreement stress test (ground truth: 2000 Chrysler Cirrus, red, front bumper missing; models tend to guess Citroën vs. Chrysler)
- `clean_car.jpg` — undamaged vehicle; minor pre-existing wear only (**REJECT**)
