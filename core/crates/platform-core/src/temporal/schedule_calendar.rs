//! Buzz cron -> native Temporal calendar, never a timer/evaluator.
//! Adapted from Temporal d94e34a1ebba5410a2e7d07119a76896909591aa:
//! service/worker/scheduler/calendar.go::parseCalendarToStructured/makeRange/parseValue
//! and spec.go::CleanSpec. Buzz's pinned cron 0.16 uses Sunday=1, unlike
//! Temporal's Sunday=0. Translate the weekday ordinal, not the execution date.
use super::TemporalError;
use temporalio_common::protos::temporal::api::schedule::v1::{Range, StructuredCalendarSpec};

fn invalid() -> TemporalError {
    TemporalError::Encode("Schedule cron 不成立".into())
}

#[derive(Clone, Copy)]
enum Field {
    Integer,
    Month,
    Weekday,
}

fn value(text: &str, min: i32, max: i32, field: Field) -> Result<i32, TemporalError> {
    let names: &[&str] = match field {
        Field::Integer => &[],
        Field::Month => &[
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ],
        Field::Weekday => &[
            "sunday",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
        ],
    };
    let text = text.to_ascii_lowercase();
    // Exact aliases from Buzz's pinned cron 0.16 MONTH_MAP/DAY_OF_WEEK_MAP.
    let named = names
        .iter()
        .position(|name| {
            *name == text
                || (text.len() == 3 && name.starts_with(&text))
                || (matches!(field, Field::Weekday)
                    && ((text == "tues" && *name == "tuesday")
                        || (text == "thurs" && *name == "thursday")))
        })
        .map(|index| index as i32 + 1);
    let parsed = match named {
        Some(value) => value,
        None if !text.is_empty() && text.bytes().all(|ch| ch.is_ascii_digit()) => {
            text.parse::<i32>().map_err(|_| invalid())?
        }
        None => return Err(invalid()),
    };
    if parsed < min || parsed > max {
        return Err(invalid());
    }
    Ok(parsed)
}

fn ranges(text: &str, min: i32, max: i32, field: Field) -> Result<Vec<Range>, TemporalError> {
    let mut result = Vec::new();
    for piece in text.split(',') {
        let (piece, step, stepped) = match piece.split_once('/') {
            Some((base, step)) => (base, value(step, 1, i32::MAX, Field::Integer)?, true),
            None => (piece, 1, false),
        };
        let (mut start, mut end) = if piece == "*" {
            (min, max)
        } else if let Some((start, end)) = piece.split_once('-') {
            let start = value(start, min, max, field)?;
            (start, value(end, start, max, field)?)
        } else {
            let start = value(piece, min, max, field)?;
            (start, if stepped { max } else { start })
        };
        // Buzz cron::DaysOfWeek uses 1=Sunday through 7=Saturday.
        // StructuredCalendarSpec uses 0=Sunday through 6=Saturday.
        if matches!(field, Field::Weekday) {
            start -= 1;
            end -= 1;
        }
        // DescribeSchedule calls CleanSpec: singleton end=start and step=1.
        result.push(Range { start, end, step });
    }
    Ok(result)
}

pub(super) fn calendar(cron: &str) -> Result<StructuredCalendarSpec, TemporalError> {
    let fields: Vec<_> = cron.split_whitespace().collect();
    // Buzz 779af8886caae1317b4de962082429867ab61503:
    // crates/buzz-workflow/src/schema.rs::normalize_cron. Six means seconds,
    // unlike Temporal's six-field CronString (which means an explicit year).
    let (second, minute, hour, day, month, weekday, year) = match fields.as_slice() {
        [minute, hour, day, month, weekday] => ("0", *minute, *hour, *day, *month, *weekday, "*"),
        [second, minute, hour, day, month, weekday] => {
            (*second, *minute, *hour, *day, *month, *weekday, "*")
        }
        [second, minute, hour, day, month, weekday, year] => {
            (*second, *minute, *hour, *day, *month, *weekday, *year)
        }
        _ => return Err(invalid()),
    };
    Ok(StructuredCalendarSpec {
        second: ranges(second, 0, 59, Field::Integer)?,
        minute: ranges(minute, 0, 59, Field::Integer)?,
        hour: ranges(hour, 0, 23, Field::Integer)?,
        day_of_month: ranges(day, 1, 31, Field::Integer)?,
        month: ranges(month, 1, 12, Field::Month)?,
        day_of_week: ranges(weekday, 1, 7, Field::Weekday)?,
        // Native wildcard year is the empty range list.
        year: if year == "*" {
            vec![]
        } else {
            ranges(year, 2000, 2100, Field::Integer)?
        },
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::temporal::automation_schedule_spec;
    use serde_json::json;

    #[test]
    fn buzz_normalization_preserves_seconds_and_year_in_native_calendar() {
        let five = calendar("5,9 */2 * JAN,MAR MON-FRI").unwrap();
        assert_eq!(
            five.second,
            vec![Range {
                start: 0,
                end: 0,
                step: 1
            }]
        );
        assert_eq!(
            five.minute,
            vec![
                Range {
                    start: 5,
                    end: 5,
                    step: 1
                },
                Range {
                    start: 9,
                    end: 9,
                    step: 1
                }
            ]
        );
        assert_eq!(
            five.hour,
            vec![Range {
                start: 0,
                end: 23,
                step: 2
            }]
        );
        assert_eq!(
            five.month,
            vec![
                Range {
                    start: 1,
                    end: 1,
                    step: 1
                },
                Range {
                    start: 3,
                    end: 3,
                    step: 1
                }
            ]
        );
        assert_eq!(
            five.day_of_week,
            vec![Range {
                start: 1,
                end: 5,
                step: 1
            }]
        );
        assert!(five.year.is_empty());
        assert_eq!(five, calendar("0 5,9 */2 * JAN,MAR MON-FRI").unwrap());
        assert_eq!(five, calendar("0 5,9 */2 * JAN,MAR MON-FRI *").unwrap());
        assert_eq!(
            five,
            calendar("0 5,9 */2 * January,March Monday-Friday *").unwrap()
        );
        assert_eq!(
            calendar("0 9 * * TUES-THURS").unwrap(),
            calendar("0 9 * * TUE-THU").unwrap()
        );
        let seconds = calendar("15 5 9 * * * 2027").unwrap();
        assert_eq!(seconds.second[0].start, 15);
        assert_eq!(seconds.year[0].start, 2027);
    }

    #[test]
    fn buzz_weekday_ordinals_are_translated_without_changing_dates() {
        assert_eq!(
            calendar("0 9 * * 1").unwrap().day_of_week,
            vec![Range {
                start: 0,
                end: 0,
                step: 1
            }]
        );
        assert_eq!(
            calendar("0 9 * * 7").unwrap().day_of_week,
            vec![Range {
                start: 6,
                end: 6,
                step: 1
            }]
        );
        assert_eq!(
            calendar("0 9 * * 1-7/2").unwrap().day_of_week,
            vec![Range {
                start: 0,
                end: 6,
                step: 2
            }]
        );
        assert_eq!(
            calendar("0 9 * * 3-7/3").unwrap().day_of_week,
            vec![Range {
                start: 2,
                end: 6,
                step: 3
            }]
        );
        assert_eq!(
            calendar("0 9 * * 1-7").unwrap().day_of_week,
            vec![Range {
                start: 0,
                end: 6,
                step: 1
            }]
        );
        assert_eq!(
            calendar("0 9 * * MON-FRI").unwrap().day_of_week,
            calendar("0 9 * * 2-6").unwrap().day_of_week
        );
    }

    #[test]
    fn interval_wire_compatibility_and_cron_schedule_are_not_approximated() {
        let (old, catchup) = automation_schedule_spec(
            &json!({"everySeconds":300,"offsetSeconds":17,"catchupWindowSeconds":60}),
        )
        .unwrap();
        assert_eq!(catchup, 60);
        assert_eq!(old.interval[0].interval.as_ref().unwrap().seconds, 300);
        assert_eq!(old.interval[0].phase.as_ref().unwrap().seconds, 17);
        let (cron, _) = automation_schedule_spec(
            &json!({"kind":"CRON","cron":"0 9 * * MON-FRI","catchupWindowSeconds":60}),
        )
        .unwrap();
        assert!(cron.interval.is_empty());
        assert!(cron.cron_string.is_empty());
        assert_eq!(cron.structured_calendar.len(), 1);
        let mut wrong = cron.clone();
        wrong.structured_calendar[0].hour[0].start = 10;
        assert_ne!(wrong, cron);
    }

    #[test]
    fn ambiguous_or_unrepresentable_schedule_is_rejected() {
        for spec in [
            json!({"cron":"0 9 * * *","catchupWindowSeconds":60}),
            json!({"kind":"CRON","cron":"0 9 * * *","everySeconds":60,"catchupWindowSeconds":60}),
            json!({"kind":"UNKNOWN","everySeconds":60,"offsetSeconds":0,"catchupWindowSeconds":60}),
            json!({"kind":"CRON","cron":"0 9 * * *","catchupWindowSeconds":9}),
        ] {
            assert!(automation_schedule_spec(&spec).is_err(), "{spec}");
        }
        for text in [
            "0 9 * *",
            "60 9 * * *",
            "0 9 * * MON-SUN",
            "0/0 9 * * *",
            "0/2/3 9 * * *",
            "0 9 * * 2-1",
            "0 9 * * 1,,2",
            "0 9 * * 0",
            "0 9 * * 8",
            "0 0 9 * * * 2101",
            "CRON_TZ=UTC 0 9 * * *",
            "@hourly",
        ] {
            assert!(calendar(text).is_err(), "{text}");
        }
    }
}
