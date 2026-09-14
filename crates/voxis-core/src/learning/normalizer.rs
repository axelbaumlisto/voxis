//! Suggestion normalizer for tech terms.
//!
//! Normalizes common tech term misspellings/phonetic spellings to proper form.
//! Ported from Python soupawhisper's suggestion_normalizer.py.
//!
//! DRY: Uses term_variants! macro to group aliases per term.

use once_cell::sync::Lazy;
use std::collections::HashMap;

use crate::llm::DictionarySuggestion;

/// Macro for defining term variants. Maps multiple aliases to a canonical form.
/// Usage: term_variants!(map, "Canonical" => ["alias1", "alias2", "alias3"]);
macro_rules! term_variants {
    ($map:expr, $($canonical:expr => [$($alias:expr),+ $(,)?]),+ $(,)?) => {
        $(
            $(
                $map.insert($alias, $canonical);
            )+
        )+
    };
}

/// Tech term mappings: phonetic/lowercase -> proper form.
/// Covers common programming terms, frameworks, and tools.
/// DRY: Grouped by term using term_variants! macro.
static TERM_MAPPINGS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();

    // ==========================================================================
    // Design Principles
    // ==========================================================================
    term_variants!(m,
        "SOLID" => ["solid", "солид", "солiд"],
        "DRY" => ["dry", "драй", "драi"],
        "KISS" => ["kiss", "кисс", "кіс"],
        "YAGNI" => ["yagni", "ягни"],
    );

    // ==========================================================================
    // Acronyms & Protocols
    // ==========================================================================
    term_variants!(m,
        "API" => ["api", "апи", "апі"],
        "REST" => ["rest", "рест"],
        "GraphQL" => ["graphql", "графкл"],
        "gRPC" => ["grpc"],
        "SQL" => ["sql", "эскюэль"],
        "NoSQL" => ["nosql"],
        "JSON" => ["json", "джейсон"],
        "XML" => ["xml"],
        "YAML" => ["yaml"],
        "HTML" => ["html"],
        "CSS" => ["css"],
        "HTTP" => ["http"],
        "HTTPS" => ["https"],
        "URL" => ["url"],
        "URI" => ["uri"],
        "JWT" => ["jwt"],
        "OAuth" => ["oauth"],
        "SAML" => ["saml"],
        "SSH" => ["ssh"],
        "SSL" => ["ssl"],
        "TLS" => ["tls"],
        "TCP" => ["tcp"],
        "UDP" => ["udp"],
        "IP" => ["ip"],
        "DNS" => ["dns"],
        "CDN" => ["cdn"],
        "CLI" => ["cli"],
        "GUI" => ["gui"],
        "IDE" => ["ide"],
        "SDK" => ["sdk"],
        "npm" => ["npm"],
        "CI" => ["ci"],
        "CD" => ["cd"],
        "CI/CD" => ["ci/cd", "cicd"],
        "DevOps" => ["devops"],
        "MLOps" => ["mlops"],
        "SRE" => ["sre"],
        "AWS" => ["aws"],
        "GCP" => ["gcp"],
        "Azure" => ["azure"],
    );

    // ==========================================================================
    // AI/ML Terms
    // ==========================================================================
    term_variants!(m,
        "AI" => ["ai"],
        "ML" => ["ml"],
        "NLP" => ["nlp"],
        "LLM" => ["llm"],
        "GPT" => ["gpt"],
        "ChatGPT" => ["chatgpt", "chat gpt", "чат гпт", "чатгпт"],
        "OpenAI" => ["openai"],
        "Anthropic" => ["anthropic"],
        "Claude" => ["claude", "клод"],
        "Gemini" => ["gemini"],
    );

    // ==========================================================================
    // Programming Languages
    // ==========================================================================
    term_variants!(m,
        "Python" => ["python", "пайтон", "питон"],
        "JavaScript" => ["javascript", "джаваскрипт"],
        "TypeScript" => ["typescript", "тайпскрипт"],
        "Rust" => ["rust", "раст"],
        "Go" => ["golang"],
        "Java" => ["java", "джава"],
        "Kotlin" => ["kotlin", "котлин"],
        "Swift" => ["swift", "свифт"],
        "C++" => ["c++", "cpp"],
        "C#" => ["csharp", "c#"],
        "Ruby" => ["ruby", "руби"],
        "PHP" => ["php"],
        "Scala" => ["scala"],
        "Haskell" => ["haskell"],
        "Elixir" => ["elixir"],
    );

    // ==========================================================================
    // Frameworks & Libraries
    // ==========================================================================
    term_variants!(m,
        "React" => ["react", "реакт"],
        "Vue" => ["vue", "вью"],
        "Angular" => ["angular", "ангуляр"],
        "Next.js" => ["nextjs", "next.js", "некст"],
        "Nuxt" => ["nuxt"],
        "Svelte" => ["svelte"],
        "Node.js" => ["nodejs", "node.js", "node", "нода"],
        "Deno" => ["deno"],
        "Bun" => ["bun"],
        "Django" => ["django", "джанго"],
        "Flask" => ["flask", "фласк"],
        "FastAPI" => ["fastapi", "фастапи"],
        "Express" => ["express", "экспресс"],
        "NestJS" => ["nestjs"],
        "Spring" => ["spring", "спринг"],
        "Rails" => ["rails", "рейлс"],
        "Laravel" => ["laravel", "ларавель"],
    );

    // ==========================================================================
    // DevOps Tools
    // ==========================================================================
    term_variants!(m,
        "Docker" => ["docker", "докер"],
        "Kubernetes" => ["kubernetes", "кубернетес"],
        "K8s" => ["k8s"],
        "Helm" => ["helm"],
        "Terraform" => ["terraform", "терраформ"],
        "Ansible" => ["ansible"],
        "Jenkins" => ["jenkins", "дженкинс"],
        "GitLab" => ["gitlab", "гитлаб"],
        "GitHub" => ["github", "гитхаб"],
        "Git" => ["git", "гит"],
        "Bitbucket" => ["bitbucket"],
        "Nginx" => ["nginx", "нджинкс"],
        "Apache" => ["apache"],
    );

    // ==========================================================================
    // Databases
    // ==========================================================================
    term_variants!(m,
        "PostgreSQL" => ["postgres", "postgresql", "постгрес"],
        "MySQL" => ["mysql", "мускул"],
        "MongoDB" => ["mongodb", "монго"],
        "Redis" => ["redis", "редис"],
        "Elasticsearch" => ["elasticsearch", "эластик"],
        "Cassandra" => ["cassandra"],
        "SQLite" => ["sqlite"],
        "DynamoDB" => ["dynamodb"],
        "Firebase" => ["firebase"],
        "Supabase" => ["supabase"],
    );

    // ==========================================================================
    // Testing Tools
    // ==========================================================================
    term_variants!(m,
        "pytest" => ["pytest", "пайтест"],
        "Jest" => ["jest", "джест"],
        "Mocha" => ["mocha"],
        "Cypress" => ["cypress"],
        "Playwright" => ["playwright", "плейрайт"],
        "Selenium" => ["selenium", "селениум"],
    );

    // ==========================================================================
    // Libraries
    // ==========================================================================
    term_variants!(m,
        "Pydantic" => ["pydantic", "пайдантик"],
        "SQLAlchemy" => ["sqlalchemy", "алхимия"],
        "pandas" => ["pandas", "пандас"],
        "NumPy" => ["numpy", "нампай"],
        "SciPy" => ["scipy"],
        "TensorFlow" => ["tensorflow", "тензорфлоу"],
        "PyTorch" => ["pytorch", "пайторч"],
        "Keras" => ["keras", "кераз"],
        "OpenCV" => ["opencv"],
    );

    // ==========================================================================
    // Concepts & Architecture
    // ==========================================================================
    term_variants!(m,
        "Backend" => ["backend", "бэкенд", "бекенд"],
        "Frontend" => ["frontend", "фронтенд"],
        "Fullstack" => ["fullstack", "фулстек"],
        "Microservices" => ["microservices", "микросервисы"],
        "Serverless" => ["serverless", "серверлесс"],
        "Webhook" => ["webhook", "вебхук"],
        "WebSocket" => ["websocket", "вебсокет"],
        "Middleware" => ["middleware", "миддлвэр"],
        "ORM" => ["orm"],
        "CRUD" => ["crud"],
        "MVC" => ["mvc"],
        "MVVM" => ["mvvm"],
        "SPA" => ["spa"],
        "SSR" => ["ssr"],
        "SSG" => ["ssg"],
        "PWA" => ["pwa"],
    );

    // ==========================================================================
    // Version Control
    // ==========================================================================
    term_variants!(m,
        "Merge" => ["merge", "мерж"],
        "Rebase" => ["rebase", "ребейз"],
        "Pull Request" => ["pull request", "пул реквест"],
        "Commit" => ["commit", "коммит"],
    );

    m
});

/// Normalizer for dictionary suggestions.
pub struct SuggestionNormalizer;

impl SuggestionNormalizer {
    /// Normalize a suggestion using TERM_MAPPINGS.
    ///
    /// If the source matches a known term, returns the proper form.
    /// Otherwise, returns the suggestion unchanged.
    pub fn normalize(suggestion: &DictionarySuggestion) -> DictionarySuggestion {
        let source_lower = suggestion.source.to_lowercase();

        if let Some(&proper_form) = TERM_MAPPINGS.get(source_lower.as_str()) {
            DictionarySuggestion {
                source: suggestion.source.clone(),
                replacement: proper_form.to_string(),
            }
        } else {
            suggestion.clone()
        }
    }

    /// Check if a source term has a known normalization.
    pub fn has_mapping(source: &str) -> bool {
        TERM_MAPPINGS.contains_key(source.to_lowercase().as_str())
    }

    /// Get the proper form for a source term, if known.
    pub fn get_proper_form(source: &str) -> Option<&'static str> {
        TERM_MAPPINGS.get(source.to_lowercase().as_str()).copied()
    }

    /// Validate a suggestion.
    ///
    /// Returns true if the suggestion is valid:
    /// - Not empty
    /// - Source and replacement are different
    pub fn is_valid(suggestion: &DictionarySuggestion) -> bool {
        let source = suggestion.source.trim();
        let replacement = suggestion.replacement.trim();

        // Skip empty
        if source.is_empty() || replacement.is_empty() {
            return false;
        }

        // Skip if no change
        if source == replacement {
            return false;
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_known_term() {
        let suggestion = DictionarySuggestion {
            source: "солид".to_string(),
            replacement: "SOLID".to_string(), // May already be correct
        };
        let normalized = SuggestionNormalizer::normalize(&suggestion);
        assert_eq!(normalized.replacement, "SOLID");
    }

    #[test]
    fn test_normalize_unknown_passthrough() {
        let suggestion = DictionarySuggestion {
            source: "myterm".to_string(),
            replacement: "MyTerm".to_string(),
        };
        let normalized = SuggestionNormalizer::normalize(&suggestion);
        assert_eq!(normalized.replacement, "MyTerm"); // Unchanged
    }

    #[test]
    fn test_has_mapping() {
        assert!(SuggestionNormalizer::has_mapping("solid"));
        assert!(SuggestionNormalizer::has_mapping("SOLID")); // Case insensitive
        assert!(SuggestionNormalizer::has_mapping("солид"));
        assert!(!SuggestionNormalizer::has_mapping("randomword"));
    }

    #[test]
    fn test_get_proper_form() {
        assert_eq!(
            SuggestionNormalizer::get_proper_form("docker"),
            Some("Docker")
        );
        assert_eq!(
            SuggestionNormalizer::get_proper_form("докер"),
            Some("Docker")
        );
        assert_eq!(SuggestionNormalizer::get_proper_form("unknown"), None);
    }

    #[test]
    fn test_is_valid() {
        // Valid
        assert!(SuggestionNormalizer::is_valid(&DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "SOLID".to_string(),
        }));

        // Invalid - empty source
        assert!(!SuggestionNormalizer::is_valid(&DictionarySuggestion {
            source: "".to_string(),
            replacement: "SOLID".to_string(),
        }));

        // Invalid - empty replacement
        assert!(!SuggestionNormalizer::is_valid(&DictionarySuggestion {
            source: "solid".to_string(),
            replacement: "".to_string(),
        }));

        // Invalid - same value
        assert!(!SuggestionNormalizer::is_valid(&DictionarySuggestion {
            source: "SOLID".to_string(),
            replacement: "SOLID".to_string(),
        }));
    }

    #[test]
    fn test_normalize_with_wrong_replacement() {
        // Normalizer should use TERM_MAPPINGS replacement, not input
        let suggestion = DictionarySuggestion {
            source: "docker".to_string(),
            replacement: "wrong".to_string(),
        };
        let normalized = SuggestionNormalizer::normalize(&suggestion);
        assert_eq!(normalized.replacement, "Docker");
    }

    #[test]
    fn test_cyrillic_to_latin_mapping() {
        // Test multiple Cyrillic -> Latin mappings
        let test_cases = vec![
            ("питон", "Python"),
            ("реакт", "React"),
            ("гитхаб", "GitHub"),
            ("докер", "Docker"),
        ];

        for (source, expected) in test_cases {
            assert_eq!(
                SuggestionNormalizer::get_proper_form(source),
                Some(expected),
                "Failed for: {}",
                source
            );
        }
    }

    #[test]
    fn test_is_valid_whitespace_only() {
        assert!(!SuggestionNormalizer::is_valid(&DictionarySuggestion {
            source: "   ".to_string(),
            replacement: "test".to_string(),
        }));

        assert!(!SuggestionNormalizer::is_valid(&DictionarySuggestion {
            source: "test".to_string(),
            replacement: "   ".to_string(),
        }));
    }

    #[test]
    fn test_normalize_abbreviations() {
        // Test common abbreviations
        let test_cases = vec![
            ("api", "API"),
            ("sql", "SQL"),
            ("html", "HTML"),
            ("css", "CSS"),
            ("json", "JSON"),
            ("ci/cd", "CI/CD"),
        ];

        for (source, expected) in test_cases {
            assert_eq!(
                SuggestionNormalizer::get_proper_form(source),
                Some(expected),
                "Failed for: {}",
                source
            );
        }
    }

    #[test]
    fn test_normalize_case_insensitive_mappings() {
        // All variations should map to same result
        assert_eq!(
            SuggestionNormalizer::get_proper_form("DOCKER"),
            Some("Docker")
        );
        assert_eq!(
            SuggestionNormalizer::get_proper_form("Docker"),
            Some("Docker")
        );
        assert_eq!(
            SuggestionNormalizer::get_proper_form("dOcKeR"),
            Some("Docker")
        );
    }

    #[test]
    fn test_normalize_empty_string() {
        assert_eq!(SuggestionNormalizer::get_proper_form(""), None);
        assert!(!SuggestionNormalizer::has_mapping(""));
    }

    #[test]
    fn test_no_duplicate_mappings() {
        // Verify that the same canonical term appears for multiple aliases
        let docker_aliases = ["docker", "докер"];
        let results: Vec<_> = docker_aliases
            .iter()
            .map(|a| SuggestionNormalizer::get_proper_form(a))
            .collect();

        // All should return Some("Docker")
        assert!(results.iter().all(|r| *r == Some("Docker")));
    }

    #[test]
    fn test_normalize_preserves_source() {
        let suggestion = DictionarySuggestion {
            source: "SOLID".to_string(),
            replacement: "wrong".to_string(),
        };
        let normalized = SuggestionNormalizer::normalize(&suggestion);

        // Source should be preserved, only replacement changes
        assert_eq!(normalized.source, "SOLID");
        assert_eq!(normalized.replacement, "SOLID");
    }

    #[test]
    fn test_frameworks_normalization() {
        // Test framework names
        let frameworks = vec![
            ("react", "React"),
            ("реакт", "React"),
            ("vue", "Vue"),
            ("angular", "Angular"),
            ("django", "Django"),
            ("fastapi", "FastAPI"),
        ];

        for (source, expected) in frameworks {
            assert_eq!(
                SuggestionNormalizer::get_proper_form(source),
                Some(expected),
                "Failed for framework: {}",
                source
            );
        }
    }

    #[test]
    fn test_cloud_providers_normalization() {
        assert_eq!(SuggestionNormalizer::get_proper_form("aws"), Some("AWS"));
        assert_eq!(SuggestionNormalizer::get_proper_form("gcp"), Some("GCP"));
        assert_eq!(
            SuggestionNormalizer::get_proper_form("azure"),
            Some("Azure")
        );
    }

    #[test]
    fn test_ai_terms_normalization() {
        let ai_terms = vec![
            ("ai", "AI"),
            ("ml", "ML"),
            ("llm", "LLM"),
            ("gpt", "GPT"),
            ("chatgpt", "ChatGPT"),
            ("claude", "Claude"),
        ];

        for (source, expected) in ai_terms {
            assert_eq!(
                SuggestionNormalizer::get_proper_form(source),
                Some(expected),
                "Failed for AI term: {}",
                source
            );
        }
    }

    #[test]
    fn test_design_principles_normalization() {
        assert_eq!(
            SuggestionNormalizer::get_proper_form("solid"),
            Some("SOLID")
        );
        assert_eq!(SuggestionNormalizer::get_proper_form("dry"), Some("DRY"));
        assert_eq!(SuggestionNormalizer::get_proper_form("kiss"), Some("KISS"));
        assert_eq!(
            SuggestionNormalizer::get_proper_form("yagni"),
            Some("YAGNI")
        );
    }
}
