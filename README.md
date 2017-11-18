# An Iterated Greedy algorithm applied in scheduling with rejection and tardiness penalties

In classical scheduling problems, it is assumed that all jobs are to be processed. However, in many practical cases, especially on make-to-order production systems, accept all requests may cause a delay in the completion of orders, leading to higher inventory costs and customer dissatisfaction. For be more similar to real problems, the study of scheduling with rejection has received great attention by researchers in the past decade. 
This study aimed to develop an algorithm based on Iterated Greedy technique and apply it in a scheduling problem with rejection and tardiness penalties, in a single machine environment, comparing the results with those found by other metaheuristics in the literature.
The Iterated Greedy metaheuristic proposed by [Ruiz and Stützle (2005)](http://www.sciencedirect.com/science/article/pii/S0377221706008277) has two phases working in an iterative way. In the phase of destruction, some tasks are eliminated from the current solution, obtaining a partial solution, and in the construction phase, the tasks are inserted in this partial solution until forming a new complete solution. In this application, the basic structure of the Iterated Greedy algorithm was expanded to solve problems of scheduling with rejection and tardiness penalty. 
From a set of instances to provide an industrial basis to test scheduling algorithms known as [MascLib](https://www.researchgate.net/publication/281228499_Towards_an_industrial_Manufacturing_Scheduling_Problem_and_Test_Bed) (MaSc standing for Manufacturing Scheduling) developed by [ILOG (IBM)](https://www-01.ibm.com/software/info/ilog/), the algorithm must decide what job should or should not be done by setting a schedule so that all constraints of the problem are obeyed and the optimization criterion is minimized. The optimization criterion is a linear combination of the sum of the jobs processed costs (other than processing costs, setup costs and tardiness costs may occur), and the sum of rejection costs of unprocessed jobs. The results found by the algorithm proposed (in terms of results and computational time) were equivalent to the results obtained by the metaheuristics in the literature [Thevenin, Zufferey, Widmer (2015)](https://link.springer.com/article/10.1007/s10951-014-0395-8). Regarding the 44 instances tested, 36 had results equal to optimal solution in the literature, 2 had better than optimal solution and the rest obtained results close to optimal. 

Free knowledge for ALL!
[Sci-hub](http://sci-hub.cc/)


### Requirements

This Metaheuristic was developed using [Anaconda](https://www.continuum.io/downloads) but it should also work with other Python installations as long as you have NumPy, Pandas, MatPlotLib and PyQt5 installed.

The versions used were:

Python 3.6.2
matplotlib v2.1.0
numpy v1.13.3
pandas v0.21.0
PyQt5 v5.9.1


## Instalation

Download and install Python v3.6 or above at [www.python.org.](www.python.org)

If you are using [Anaconda](https://www.anaconda.com/download/) then you can install all required Python packages by running the following commands in a shell:

    conda create --name tf python=3
    pip install -r requirements.txt
    
You can run the program by entering:

    python application.py