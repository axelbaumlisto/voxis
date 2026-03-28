//! Learning mode enum and parsing.

/// Learning mode for dictionary updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LearningMode {
    /// Learning disabled - suggestions are ignored
    Disabled,
    /// Pending mode - suggestions are stored but require manual approval
    Pending,
    /// Auto mode - suggestions are automatically added after threshold
    #[default]
    Auto,
}

impl std::str::FromStr for LearningMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "disabled" => Ok(Self::Disabled),
            "pending" => Ok(Self::Pending),
            "auto" => Ok(Self::Auto),
            _ => Err(format!("Unknown learning mode: {}", s)),
        }
    }
}

impl std::fmt::Display for LearningMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => write!(f, "disabled"),
            Self::Pending => write!(f, "pending"),
            Self::Auto => write!(f, "auto"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_learning_mode_from_str() {
        assert_eq!(
            "disabled".parse::<LearningMode>().unwrap(),
            LearningMode::Disabled
        );
        assert_eq!(
            "pending".parse::<LearningMode>().unwrap(),
            LearningMode::Pending
        );
        assert_eq!("auto".parse::<LearningMode>().unwrap(), LearningMode::Auto);
        assert_eq!(
            "DISABLED".parse::<LearningMode>().unwrap(),
            LearningMode::Disabled
        );
        assert_eq!("Auto".parse::<LearningMode>().unwrap(), LearningMode::Auto);
        assert!("invalid".parse::<LearningMode>().is_err());
    }

    #[test]
    fn test_learning_mode_display() {
        assert_eq!(format!("{}", LearningMode::Disabled), "disabled");
        assert_eq!(format!("{}", LearningMode::Pending), "pending");
        assert_eq!(format!("{}", LearningMode::Auto), "auto");
    }

    #[test]
    fn test_learning_mode_default() {
        assert_eq!(LearningMode::default(), LearningMode::Auto);
    }

    #[test]
    fn test_learning_mode_clone() {
        let mode = LearningMode::Pending;
        let cloned = mode;
        assert_eq!(mode, cloned);
    }

    #[test]
    fn test_learning_mode_eq() {
        assert_eq!(LearningMode::Auto, LearningMode::Auto);
        assert_ne!(LearningMode::Auto, LearningMode::Disabled);
    }
}
