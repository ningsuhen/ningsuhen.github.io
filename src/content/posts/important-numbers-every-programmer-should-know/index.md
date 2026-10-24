---
title: Important numbers every programmer should know
published: 2015-11-06
description: "The latency and reference numbers every programmer should have memorized, plus base-2 exponents and time units."
image: ./cover.png
thumbnail: ./thumb.webp
tags: [latency numbers, Jeff Dean]
category: Programming
draft: false
---

These are some of the most important numbers that every programmer should know. The second (Power of 2s) and 3rd (time units in terms of seconds) are quite obvious but I like to keep them in place so that I can remember them quickly. However, the most important one is Jeff Dean's numbers. Here we go:

## Jeff Dean's Numbers

```text title="latency.txt"
Latency Comparison Numbers
--------------------------
L1 cache reference                            0.5 ns
Branch mispredict                             5   ns
L2 cache reference                            7   ns             14x L1 cache
Mutex lock/unlock                            25   ns
Main memory reference                       100   ns             20x L2 cache, 200x L1 cache
Compress 1K bytes with Zippy              3,000   ns
Send 1K bytes over 1 Gbps network        10,000   ns    0.01 ms
Read 4K randomly from SSD*              150,000   ns    0.15 ms
Read 1 MB sequentially from memory      250,000   ns    0.25 ms
Round trip within same datacenter       500,000   ns    0.5  ms
Read 1 MB sequentially from SSD*      1,000,000   ns    1    ms  4X memory
Disk seek                            10,000,000   ns   10    ms  20x datacenter roundtrip
Read 1 MB sequentially from disk     20,000,000   ns   20    ms  80x memory, 20X SSD
Send packet CA->Netherlands->CA     150,000,000   ns  150    ms

Notes
-----
1 ns = 10-9 seconds
1 ms = 10-3 seconds
* Assuming ~1GB/sec SSD

Credit
------
By Jeff Dean:               http://research.google.com/people/jeff/
Originally by Peter Norvig: http://norvig.com/21-days.html#answers

Contributions
-------------
Some updates from:                      https://gist.github.com/2843375
Great 'humanized' comparison version:   https://gist.github.com/2843375
Visual comparison chart:                http://i.imgur.com/k0t1e.png
Nice animated presentation of the data: http://prezi.com/pdkvgys-r0y6/latency-numbers-for-programmers-web-development/
```

Original gist: https://gist.github.com/ningsuhen/2f2ffb2b82c372cdd079

## Base 2 Exponents

$$
\begin{align*}
2^0     &=             1\\
2^1     &=             2\\
2^2     &=             4\\
2^3     &=             8\\
2^4     &=            16\\
2^5     &=            32\\
2^6     &=            64\\
2^7     &=           128\\
2^8     &=           256\\
2^9     &=           512\\
2^{10}  &=          1024\\
2^{11}  &=          2048\\
2^{12}  &=          4096\\
2^{13}  &=          8192\\
2^{20}  &=     1,048,576\\
2^{30}  &= 1,073,741,824
\end{align*}
$$

## Time Units in seconds

$$
\begin{aligned}
1 & ns&      &=           10^{-9}\\
1 & us&      &=           10^{-6}\\
1 & ms&      &=           10^{-3}\\
1 & sec&     &=             1\\
1 & min&     &=            60\\
1 & hour&    &=          3600\\
1 & day&     &=         86400\\
1 & week&    &=       604,800 ~ 6 * 10^5\\
1 & month&   &=    18,144,000\\
1 & year&    &=   217,728,000\\
\end{aligned}
$$
