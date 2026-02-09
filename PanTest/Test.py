import itertools
import math

def get_neighbors_diff(perm):
    """Returns a list of absolute differences between neighbors."""
    return [abs(perm[i] - perm[i + 1]) for i in range(len(perm) - 1)]


def filter_A_max_smallest_neighbor_pair(candidates):
    best_score = -1
    scored_candidates = []

    for perm in candidates:
        diffs = get_neighbors_diff(perm)
        min_diff = min(diffs)

        if min_diff > best_score:
            best_score = min_diff
            scored_candidates = [perm]
        elif min_diff == best_score:
            scored_candidates.append(perm)

    return scored_candidates


def filter_B_max_total_neighbor_pairs(candidates):
    best_score = -1
    scored_candidates = []

    for perm in candidates:
        diffs = get_neighbors_diff(perm)
        total_diff = sum(diffs)

        if total_diff > best_score:
            best_score = total_diff
            scored_candidates = [perm]
        elif total_diff == best_score:
            scored_candidates.append(perm)

    return scored_candidates


def filter_C_closest_to_middle_right(candidates, value):
    """
    Priority C: Low values prefers middle (right). (Translates to musically high parts.)
    """
    n = len(candidates[0])
    target_index = math.ceil((n - 1) / 2)

    best_dist = float('inf')
    b_d_good_side = False
    scored_candidates = []

    for perm in candidates:
        index_of_val = perm.index(value)
        good_side = index_of_val >= target_index
        dist = abs(index_of_val - target_index)

        if dist < best_dist:
            best_dist = dist
            b_d_good_side = good_side
            scored_candidates = [perm]
        elif dist == best_dist:
            if b_d_good_side:
                if good_side:
                    scored_candidates.append(perm)
            else:
                if not good_side:
                    scored_candidates.append(perm)
                if good_side:
                    scored_candidates = [perm]
                    b_d_good_side = True

    return scored_candidates


def filter_D_closest_to_middle_left(candidates, value):
    """
    Priority D: High values prefers middle (left). (Translates to musically low parts.)
    """
    n = len(candidates[0])
    target_index = math.floor((n - 1) / 2)

    best_dist = float('inf')
    b_d_good_side = False
    scored_candidates = []

    for perm in candidates:
        index_of_val = perm.index(value)
        good_side = index_of_val <= target_index
        dist = abs(index_of_val - target_index)

        if dist < best_dist:
            best_dist = dist
            b_d_good_side = good_side
            scored_candidates = [perm]
        elif dist == best_dist:
            if b_d_good_side:
                if good_side:
                    scored_candidates.append(perm)
            else:
                if not good_side:
                    scored_candidates.append(perm)
                if good_side:
                    scored_candidates = [perm]
                    b_d_good_side = True


    return scored_candidates


def solve_order(n, strategy):
    initial_set = list(range(1, n + 1))

    if strategy == "Lowest-Highest":
        return initial_set

    candidates = list(itertools.permutations(initial_set))
    order_list = []

    if strategy == "Balanced Highest Middle":
        order_list = ["A", "B", ("LOOP", ("C", "D"))]

    elif strategy == "Balanced Lowest Middle":
        order_list = ["A", "B", ("LOOP", ("D", "C"))]

    elif strategy == "Forced Highest Middle":
        order_list = ["C", "A", "B", "D", "STEP", ("LOOP", ("C", "D"))]

    elif strategy == "Forced Lowest Middle":
        order_list = ["D", "A", "B", "C", "STEP", ("LOOP", ("D", "C"))]

    low_val = 1
    high_val = n

    for step in order_list:
        if len(candidates) <= 1: break

        if step == "A":
            candidates = filter_A_max_smallest_neighbor_pair(candidates)

        elif step == "B":
            candidates = filter_B_max_total_neighbor_pairs(candidates)
        
        elif step == "C":
            candidates = filter_C_closest_to_middle_right(candidates, low_val)

        elif step == "D":
            candidates = filter_D_closest_to_middle_left(candidates, high_val)

        elif step == "STEP":
            low_val += 1
            high_val -= 1

        elif step[0] == "LOOP":
            while True:
                for arg in step[1]:
                    if arg == "C":
                        candidates = filter_C_closest_to_middle_right(candidates, low_val)
                    elif arg == "D":
                        candidates = filter_D_closest_to_middle_left(candidates, high_val)
                    if len(candidates) <= 1: break
                if len(candidates) <= 1: break
                low_val += 1
                high_val -= 1



    return candidates[0]



if __name__ == "__main__":
    while True:
        print("\n" + "=" * 30)
        user_input = input("Enter number of parts (or 'q' to quit): ")
        if user_input.lower() == 'q': break
        N = int(user_input)

        if N > 10:
            print("N > 10 is too slow. Stopping.")
            continue

        print("\nSelect Strategy:")
        print("1. Balanced Highest Middle")
        print("2. Balanced Lowest Middle")
        print("3. Forced Highest Middle")
        print("4. Forced Lowest Middle")
        print("5. Lowest-Highest")

        strat_map = {
            "1": "Balanced Highest Middle",
            "2": "Balanced Lowest Middle",
            "3": "Forced Highest Middle",
            "4": "Forced Lowest Middle",
            "5": "Lowest-Highest"
        }

        s_input = input("Choice (1-5): ")
        strat = strat_map.get(s_input, "Balanced Highest Middle")

        print(f"\nCalculating for N={N}, Strategy='{strat}'...")
        result = solve_order(N, strat)
        print(f"Result: {result}")