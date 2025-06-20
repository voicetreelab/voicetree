from collections import namedtuple

NodeAction = namedtuple('NodeAction',
                        [
                            'labelled_text',
                            'action',
                            'concept_name',
                            'neighbour_concept_name',
                            'relationship_to_neighbour',
                            'updated_summary_of_node',
                            'markdown_content_to_append',
                            'is_complete'
                        ])

