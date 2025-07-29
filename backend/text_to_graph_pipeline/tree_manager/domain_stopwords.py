"""
Domain-specific stopwords for mathematical word problems about animals and locations

These words appear in almost every node and provide little discriminative value
for TF-IDF scoring in this specific domain.
"""

# Mathematical/statistical terms that appear in most nodes
MATH_STOPWORDS = {
    'average', 'number', 'total', 'sum', 'equals', 'equation',
    'per', 'each', 'every', 'all', 'count', 'amount'
}

# Common descriptors in this domain
DESCRIPTOR_STOPWORDS = {
    'adult', 'newborn', 'children', 'child', 'baby', 'babies',
    'young', 'old', 'male', 'female'
}

# Common prepositions and connectors already in NLTK but worth ensuring
ADDITIONAL_STOPWORDS = {
    'of', 'in', 'at', 'for', 'with', 'from', 'to', 'by',
    'the', 'a', 'an', 'and', 'or', 'but'
}

# Combine all domain-specific stopwords
DOMAIN_STOPWORDS = MATH_STOPWORDS | DESCRIPTOR_STOPWORDS | ADDITIONAL_STOPWORDS


def get_domain_aware_stopwords(include_nltk=True):
    """
    Get stopwords for this specific domain, optionally combined with NLTK stopwords
    
    Args:
        include_nltk: Whether to include standard NLTK stopwords
        
    Returns:
        Set of stopwords
    """
    if include_nltk:
        try:
            from nltk.corpus import stopwords
            base_stopwords = set(stopwords.words('english'))
        except:
            base_stopwords = set()
        
        return base_stopwords | DOMAIN_STOPWORDS
    else:
        return DOMAIN_STOPWORDS