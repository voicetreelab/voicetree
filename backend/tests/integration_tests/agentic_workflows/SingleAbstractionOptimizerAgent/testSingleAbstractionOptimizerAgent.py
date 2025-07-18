"""
Test some example inputs & outputs,

e.g. TEST CASE 1: a cluttered node

a current 
  bloated node = (A,B,C,D), where the actual 
  true optimal structure is A->B, A-> C, B->D

  (b is a child of a, c is a child of a, d is a
   child of b)

  we want to keep A, and have the following 
  create actions: create(target=A, newNode(B)),
   create(target=A, newNode(C)), 
  create(target=B, newNode(D)).

  
TEST CASE 2: a node which should ideally stay as a single node
cohesive node (A1,A2,A3)

These together form an abstraction which makes more sense to be kept together, because if you split it it actualyl becomes more confusing for the user to understand.


Note, we can't determinisistically test everything, but we can test the structure of the output, that it is producing tree actions that would modify the tree as we ideally want.

"""